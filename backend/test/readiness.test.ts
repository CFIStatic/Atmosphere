import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessReadiness, ceilingLabel, type JobFacts } from '../src/verifier/readiness.js';

const facts = (over: Partial<JobFacts> = {}): JobFacts => ({
  scopeLineCount: 8,
  scopeFromDocument: true,
  hasAddress: true,
  hasCoordinates: true,
  scheduledStart: '2026-08-14T13:00:00Z',
  partyCount: 2,
  intakeSource: 'crm_sync',
  ...over,
});

describe('assessReadiness', () => {
  it('calls a complete job ready, with nothing owed', () => {
    const r = assessReadiness(facts());
    assert.equal(r.level, 'ready');
    assert.equal(r.ceiling, 'full');
    assert.deepEqual(r.gaps, []);
    assert.match(r.headline, /Ready to verify/);
  });

  it('names the provenance in the headline, because how it got here is the audit answer', () => {
    assert.match(assessReadiness(facts({ intakeSource: 'crm_sync' })).headline, /synced from your CRM/);
    assert.match(assessReadiness(facts({ intakeSource: 'manual' })).headline, /entered by hand/);
    assert.match(
      assessReadiness(facts({ intakeSource: 'scope_document' })).headline,
      /read from an uploaded document/,
    );
  });

  it('omits provenance rather than inventing it when nothing was recorded', () => {
    const r = assessReadiness(facts({ intakeSource: null }));
    assert.equal(r.source, null);
    assert.ok(!/entered|synced|read from/.test(r.headline), r.headline);
  });

  it('drops the ceiling to filed-only when there is no scope to judge against', () => {
    const r = assessReadiness(facts({ scopeLineCount: 0, scopeFromDocument: false }));
    assert.equal(r.level, 'blocked');
    assert.equal(r.ceiling, 'filed_only');
    const gap = r.gaps.find((g) => g.key === 'scope');
    assert.ok(gap);
    assert.equal(gap!.severity, 'blocking');
    assert.match(gap!.costs, /sealed and filed/);
  });

  it('still tells the crew to film when the job is blocked', () => {
    // The whole point: readiness forecasts, it does not gate. A crew standing
    // in a flooded basement is never stopped by a missing field.
    const r = assessReadiness(facts({ scopeLineCount: 0 }));
    assert.match(r.headline, /Film it/);
  });

  it('drops to work-only when nobody gave the job an address', () => {
    const r = assessReadiness(facts({ hasAddress: false, hasCoordinates: false }));
    assert.equal(r.level, 'limited');
    assert.equal(r.ceiling, 'work_only');
    const gap = r.gaps.find((g) => g.key === 'address');
    assert.ok(gap);
    assert.match(gap!.costs, /location unknown/);
  });

  it('separates "no address" from "address not placed", because the fix differs', () => {
    const noAddress = assessReadiness(facts({ hasAddress: false, hasCoordinates: false }));
    const notPlaced = assessReadiness(facts({ hasAddress: true, hasCoordinates: false }));

    assert.ok(noAddress.gaps.some((g) => g.key === 'address'));
    assert.ok(!noAddress.gaps.some((g) => g.key === 'coordinates'));

    assert.ok(notPlaced.gaps.some((g) => g.key === 'coordinates'));
    assert.ok(!notPlaced.gaps.some((g) => g.key === 'address'));
    assert.equal(notPlaced.ceiling, 'work_only');
  });

  it('puts the expensive gap first, because the office reads one line', () => {
    const r = assessReadiness(
      facts({ scopeLineCount: 0, hasAddress: false, hasCoordinates: false, scheduledStart: null }),
    );
    assert.deepEqual(r.gaps.map((g) => g.key), ['scope', 'address', 'schedule']);
  });

  it('keeps the ceiling at filed-only when scope is missing even if place and time are perfect', () => {
    const r = assessReadiness(facts({ scopeLineCount: 0 }));
    assert.equal(r.ceiling, 'filed_only');
  });

  it('treats a missing schedule as weakening, never as blocking', () => {
    const r = assessReadiness(facts({ scheduledStart: null }));
    assert.equal(r.level, 'limited');
    assert.equal(r.ceiling, 'full', 'time on the clip comes from the capture, not the calendar');
    assert.equal(r.gaps.find((g) => g.key === 'schedule')!.severity, 'weakening');
  });

  it('lists what the job already has, so a mostly-fine job does not read as broken', () => {
    const r = assessReadiness(facts({ scheduledStart: null }));
    assert.ok(r.strengths.some((s) => /8 scope lines/.test(s)));
    assert.ok(r.strengths.some((s) => /uploaded document/.test(s)));
    assert.ok(r.strengths.some((s) => /on-site can be checked/.test(s)));
    assert.ok(r.strengths.some((s) => /2 subcontractors/.test(s)));
  });

  it('says where the scope came from, because a typed line loses to a signed one', () => {
    const typed = assessReadiness(facts({ scopeFromDocument: false }));
    assert.ok(typed.strengths.some((s) => s === '8 scope lines'));
    assert.ok(!typed.strengths.some((s) => /document/.test(s)));
  });

  it('counts one of something in the singular', () => {
    const r = assessReadiness(facts({ scopeLineCount: 1, scopeFromDocument: false, partyCount: 1 }));
    assert.ok(r.strengths.some((s) => s === '1 scope line'));
    assert.ok(r.strengths.some((s) => s === '1 subcontractor invited'));
  });

  it('does not treat a job with no subs as missing anything', () => {
    // Your own crew films plenty of jobs. Zero parties is normal, not a gap.
    const r = assessReadiness(facts({ partyCount: 0 }));
    assert.equal(r.level, 'ready');
    assert.ok(!r.strengths.some((s) => /subcontractor/.test(s)));
  });

  it('gives every gap an action, not just a complaint', () => {
    const r = assessReadiness(
      facts({ scopeLineCount: 0, hasAddress: false, hasCoordinates: false, scheduledStart: null }),
    );
    for (const gap of r.gaps) {
      assert.ok(gap.what.length > 0, 'names what is missing');
      assert.ok(gap.costs.length > 0, 'names what it costs');
      assert.ok(gap.fix.length > 0, `gap ${gap.key} should say how to fix it`);
    }
  });
});

describe('ceilingLabel', () => {
  it('says what the footage will establish in words a customer reads', () => {
    assert.equal(ceilingLabel('full'), 'Work, place and time');
    assert.equal(ceilingLabel('work_only'), 'Work only — no location');
    assert.equal(ceilingLabel('filed_only'), 'Filed, not verified');
  });
});
