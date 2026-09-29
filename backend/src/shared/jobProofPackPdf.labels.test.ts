import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decisionLabel, phaseLabel } from './jobProofPackPdf.js';

describe('proof pack customer labels', () => {
  it('prints enum words as sentence-case labels', () => {
    assert.equal(phaseLabel('before'), 'Before');
    assert.equal(phaseLabel('after'), 'After');
    assert.equal(phaseLabel('punch_list'), 'Punch list');
    assert.equal(phaseLabel(null), '');
  });

  it('never prints a raw pending decision', () => {
    assert.equal(decisionLabel('accepted'), 'Accepted');
    assert.equal(decisionLabel('rejected'), 'Rejected');
    assert.equal(decisionLabel('pending'), 'Not reviewed');
  });
});
