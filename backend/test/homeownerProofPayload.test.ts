import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { homeownerProofPayload } from '../src/shared/homeownerProofPayload.js';

const office = {
  job: { id: 'j1', number: 1, name: 'Maple' },
  days: [{
    partyId: 'p', company: 'Crew', workDate: '2026-10-09', hasBefore: true, hasAfter: true,
    checks: [{ ok: false }], contradicted: true, summary: 'GPS 2 mi off', payable: true, payableBecause: 'x',
    accepted: false, rejected: false, aiSummary: 'Drying set up', aiFindings: { concerns: ['internal'] },
    materialChange: 'x', analysisStatus: 'done', analysisError: 'boom', reports: { before: {} }, proofIds: ['v1'],
  }],
  videos: [{
    id: 'v1', workDate: '2026-10-09', phase: 'after', aiSummary: 'Drying set up', transcriptText: 'hi',
    contentHash: 'abc', device: { make: 'Apple', deviceId: 'dev-1' }, checks: [{}], evidenceLog: [{}],
    disputes: [{}], transcriptError: 'e', proofState: 'accepted', privacyRedactions: [{ start: 1 }],
  }],
  rooms: [],
  disputes: [{ id: 'd' }],
  punchList: [{ title: 'Fix trim', details: 'internal note' }],
  counts: { days: 1, videos: 1, payable: 1, contradicted: 1, disputes: 1, punchList: 1 },
  siteKnown: true,
};

test('homeowner Videos payload keeps the videos, drops office-only data', () => {
  const out: any = homeownerProofPayload(office);
  const json = JSON.stringify(out);
  for (const leak of ['GPS 2 mi off', 'internal note', 'internal', 'boom', 'abc', 'dev-1', 'payableBecause', 'evidenceLog']) {
    assert.ok(!json.includes(leak), `leaked ${leak}`);
  }
  assert.deepEqual(out.disputes, []);
  assert.deepEqual(out.punchList, []);
  assert.equal(out.counts.payable, 0);
  assert.equal(out.counts.videos, 1);
  assert.equal(out.videos[0].aiSummary, 'Drying set up');
  assert.equal(out.videos[0].transcriptText, 'hi');
  assert.deepEqual(out.videos[0].privacyRedactions, [{ start: 1 }]);
  assert.equal(out.days[0].summary, 'Drying set up');
});

test('GET /shared/:jobId/proof sanitizes for viewers; list query excludes deleted clips', () => {
  const src = readFileSync(new URL('../src/routes/proofOfWork.ts', import.meta.url), 'utf8');
  assert.match(src, /access === 'viewer' \? homeownerProofPayload\(payload\) : payload/);
  const list = src.slice(src.indexOf('export async function listAllVisibleProofs'));
  assert.match(list.slice(0, 600), /\.is\('deleted_at', null\)/);
});
