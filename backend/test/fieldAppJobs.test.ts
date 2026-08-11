import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFieldJobSearchOr,
  mapFieldJobRow,
  sanitizeFieldSearchQuery,
} from '../src/routes/fieldAppJobs.js';

describe('sanitizeFieldSearchQuery', () => {
  it('strips PostgREST metacharacters', () => {
    assert.equal(sanitizeFieldSearchQuery('  oak%(st), '), 'oak st');
  });
});

describe('buildFieldJobSearchOr', () => {
  it('returns null for empty query', () => {
    assert.equal(buildFieldJobSearchOr('   '), null);
  });

  it('matches title, claim, description, and job number', () => {
    const or = buildFieldJobSearchOr('#42 Oak');
    assert.ok(or);
    assert.match(or!, /title\.ilike\.%#42 Oak%/);
    assert.match(or!, /claim_number\.ilike/);
    assert.match(or!, /description\.ilike/);
    // "#42 Oak" does not parse as pure digits after stripping #
    assert.doesNotMatch(or!, /job_number\.eq/);
  });

  it('matches numeric job number with optional leading #', () => {
    const or = buildFieldJobSearchOr('#108');
    assert.ok(or);
    assert.match(or!, /job_number\.eq\.108/);
  });

  it('matches uuid ids exactly', () => {
    const id = 'b52d8f30-c716-a94e-0d5b-83a7f21c604e';
    const or = buildFieldJobSearchOr(id);
    assert.ok(or);
    assert.match(or!, new RegExp(`id\\.eq\\.${id}`));
  });

  it('includes property ids from address search', () => {
    const or = buildFieldJobSearchOr('Main', ['aaa', 'bbb']);
    assert.ok(or);
    assert.match(or!, /property_id\.in\.\(aaa,bbb\)/);
  });
});

describe('mapFieldJobRow', () => {
  it('formats number and address', () => {
    const addr = new Map([['p1', '12 Main St, Austin']]);
    const out = mapFieldJobRow(
      {
        id: 'j1',
        job_number: 9,
        title: 'Water loss',
        status: 'active',
        scheduled_start: null,
        property_id: 'p1',
      },
      addr,
    );
    assert.equal(out.number, '#9');
    assert.equal(out.name, 'Water loss');
    assert.equal(out.address, '12 Main St, Austin');
    assert.equal(out.placed, false);
    assert.equal(out.at, 'Today');
  });
});
