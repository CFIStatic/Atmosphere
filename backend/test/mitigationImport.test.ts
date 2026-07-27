import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMitigationEstimate } from '../src/estimator/estimate/mitigationImport.js';
import { FIXTURES } from '../src/estimator/connectors/fixtures.js';

describe('parseMitigationEstimate — CSV', () => {
  const estimate = parseMitigationEstimate(FIXTURES.mitigationCsv, {
    source: 'fixture',
    format: 'csv',
  });

  it('finds the table under the claim-header preamble', () => {
    assert.equal(estimate.lineItems.length, 15);
  });

  it('keeps the room each line belongs to', () => {
    const master = estimate.lineItems.filter((line) => line.roomName === 'Master Bedroom');
    assert.equal(master.length, 5);
  });

  it('reads quantities, units, and codes', () => {
    const carpet = estimate.lineItems.find((line) => /Remove carpet$/.test(line.description));
    assert.ok(carpet, 'expected a carpet removal line');
    assert.equal(carpet.quantity, 224);
    assert.equal(carpet.unit, 'SF');
    assert.equal(carpet.code, 'DMO CRPT');
  });

  it('keeps descriptions containing commas intact', () => {
    const dehu = estimate.lineItems.find((line) => /Dehumidifier/.test(line.description));
    assert.equal(dehu?.description, 'Dehumidifier - large - per day');
    assert.equal(dehu?.unit, 'DA');
  });
});

describe('parseMitigationEstimate — unit normalisation', () => {
  it('converts squares to square feet so downstream rules see one unit', () => {
    const estimate = parseMitigationEstimate(
      'Description,Quantity,Unit\n"Remove carpet",3,SQ\n',
      { source: 'test', format: 'csv' },
    );
    assert.equal(estimate.lineItems[0]?.unit, 'SF');
    assert.equal(estimate.lineItems[0]?.quantity, 300);
  });
});

describe('parseMitigationEstimate — free text from a PDF', () => {
  const pasted = `
Master Bedroom
1. Remove carpet                                   224.00 SF
2. Remove carpet pad                               224.00 SF
3. Air mover (per 24 hour period)                    8.00 DA
Living Room
4. Remove drywall - up to 2' - walls                68.00 LF
`;

  const estimate = parseMitigationEstimate(pasted, { source: 'pasted', format: 'text' });

  it('reads description, quantity, and unit off each line', () => {
    assert.equal(estimate.lineItems.length, 4);
    assert.equal(estimate.lineItems[0]?.description, 'Remove carpet');
    assert.equal(estimate.lineItems[0]?.quantity, 224);
  });

  it('carries the room heading down to the lines under it', () => {
    assert.equal(estimate.lineItems[0]?.roomName, 'Master Bedroom');
    assert.equal(estimate.lineItems[3]?.roomName, 'Living Room');
  });
});

describe('parseMitigationEstimate — format detection', () => {
  it('recognises XML by content rather than by filename', () => {
    const xml = `<?xml version="1.0"?><Estimate><ClaimNumber>CLM-1</ClaimNumber>
      <LineItem code="DMO CRPT" description="Remove carpet" quantity="120" unit="SF" room="Den"/>
      </Estimate>`;
    const estimate = parseMitigationEstimate(xml, { source: 'x.txt' });
    assert.equal(estimate.claimNumber, 'CLM-1');
    assert.equal(estimate.lineItems[0]?.roomName, 'Den');
    assert.equal(estimate.lineItems[0]?.quantity, 120);
  });

  it('refuses silently-empty results rather than returning an empty estimate', () => {
    assert.throws(
      () => parseMitigationEstimate('this file contains no line items at all', { source: 'x' }),
      /No line items could be read/,
    );
  });
});
