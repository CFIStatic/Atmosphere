import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchJob, normaliseAddress, scoreJob, similarity } from '../src/estimator/matching/jobMatcher.js';
import { FIXTURES } from '../src/estimator/connectors/fixtures.js';
import type { CrmJob, ScanProject } from '../src/estimator/types.js';

const scan: ScanProject = FIXTURES.project;

function withoutClaimNumber(project: ScanProject): ScanProject {
  return { ...project, claimNumber: undefined, policyNumber: undefined };
}

describe('normaliseAddress', () => {
  it('collapses street-suffix and directional variants', () => {
    assert.equal(
      normaliseAddress('1420 North Birchwood Street'),
      normaliseAddress('1420 N. Birchwood St'),
    );
  });
});

describe('similarity', () => {
  it('is tolerant of word order and typos', () => {
    assert.ok(similarity('maple street', 'street maple') > 0.6);
    assert.ok(similarity('birchwood', 'brichwood') > 0.5);
    assert.ok(similarity('birchwood', 'oakmont') < 0.2);
  });
});

describe('matchJob — the fixture scenario', () => {
  it('picks the job whose claim number matches, not the neighbour', () => {
    const result = matchJob(scan, FIXTURES.jobs);
    assert.equal(result.needsReview, false);
    assert.equal(result.best?.job.id, 'job-55120');
    assert.match(result.reason, /Claim number/);
  });

  it('ranks the decoy at the same street below the real job', () => {
    const [real, decoy] = FIXTURES.jobs;
    assert.ok(scoreJob(scan, real!).score > scoreJob(scan, decoy!).score);
  });
});

describe('matchJob — refusing to guess', () => {
  it('asks for a human when no candidates come back', () => {
    const result = matchJob(scan, []);
    assert.equal(result.needsReview, true);
    assert.equal(result.best, null);
  });

  it('asks for a human when two candidates are close', () => {
    // Two jobs at the same address, same insured, no claim number on the scan:
    // there is genuinely nothing left to separate them.
    const twin = (id: string, lossDate: string): CrmJob => ({
      ...FIXTURES.jobs[0]!,
      id,
      claimNumber: undefined,
      policyNumber: undefined,
      lossDate,
    });

    const result = matchJob(withoutClaimNumber(scan), [
      twin('job-a', '2026-06-14'),
      twin('job-b', '2026-06-13'),
    ]);

    assert.equal(result.needsReview, true);
    assert.match(result.reason, /within/);
  });

  it('does not let a weak address agreement clear the bar on its own', () => {
    const vague: CrmJob = {
      id: 'job-x',
      insuredName: undefined,
      address: { street: '88 Elmhurst Ave', city: 'Waterloo', state: 'IA', postalCode: '50701' },
      notes: [],
    };
    const result = matchJob(withoutClaimNumber(scan), [vague]);
    assert.equal(result.needsReview, true);
  });
});

describe('scoreJob — signals', () => {
  it('caps the address score when the house number differs', () => {
    const nextDoor: CrmJob = {
      ...FIXTURES.jobs[0]!,
      id: 'job-next-door',
      claimNumber: undefined,
      policyNumber: undefined,
      address: { ...FIXTURES.jobs[0]!.address, street: '1422 Birchwood Ln' },
    };
    const address = scoreJob(scan, nextDoor).signals.find((s) => s.field === 'address');
    assert.ok(address);
    assert.ok(address.score <= 0.45, `expected a capped address score, got ${address.score}`);
  });

  it('explains every signal it used', () => {
    const scored = scoreJob(scan, FIXTURES.jobs[0]!);
    assert.ok(scored.signals.length >= 4);
    assert.ok(scored.signals.every((signal) => signal.detail.length > 0));
  });
});
