import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { partyProofPayload } from '../src/shared/homeownerProofPayload.js';
import {
  assertViewerMayOpenProof,
  listJobPartyViews,
  viewerPartyId,
  type SharedJobAccess,
} from '../src/shared/jobProgressGrants.js';

const here = dirname(fileURLToPath(import.meta.url));
const _src = (file: string) => readFileSync(join(here, '..', file), 'utf8');

function viewer(partyId: string | null): SharedJobAccess {
  return {
    access: 'viewer',
    orgId: 'org-gc',
    userId: 'user-sub',
    role: 'viewer',
    productRole: 'employee',
    supabase: {} as SharedJobAccess['supabase'],
    readOnly: true,
    partyId,
  };
}

const officePayload = {
  job: { id: 'job-1', number: 7, name: 'Kitchen' },
  days: [
    { partyId: 'party-sub', workDate: '2026-10-10', proofIds: ['v1'], aiSummary: 'Hung drywall.', hasBefore: true, hasAfter: true },
    { partyId: 'party-other', workDate: '2026-10-10', proofIds: ['v2'], aiSummary: 'Set fans.', hasBefore: true, hasAfter: false },
  ],
  videos: [
    { id: 'v1', partyId: 'party-sub', aiSummary: 'Hung drywall.', contentHash: 'h1' },
    { id: 'v2', partyId: 'party-other', aiSummary: 'Set fans.', contentHash: 'h2' },
    { id: 'v3', partyId: 'party-office', aiSummary: 'Walkthrough.', contentHash: 'h3' },
  ],
  rooms: [{ roomKey: 'kitchen', roomName: 'Kitchen' }],
  disputes: [{ id: 'd1' }],
  punchList: [{ id: 'p1' }],
  counts: { days: 2, videos: 3, payable: 1, contradicted: 0, disputes: 1, punchList: 1, analysing: 0, awaitingAfter: 1 },
};

test('an invited sub gets only the videos and days they recorded', () => {
  type Row = Record<string, unknown>;
  const out = partyProofPayload(officePayload, 'party-sub') as unknown as {
    videos: Row[];
    days: Row[];
    rooms: Row[];
    disputes: Row[];
    punchList: Row[];
    counts: Record<string, number>;
  };
  assert.deepEqual(out.videos.map((v) => v.id), ['v1']);
  assert.deepEqual(out.days.map((d) => `${d.workDate}${d.partyId}`), ['2026-10-10party-sub']);
  assert.deepEqual(out.rooms, []);
  assert.deepEqual(out.disputes, []);
  assert.deepEqual(out.punchList, []);
  assert.equal(out.counts.videos, 1);
  assert.equal(out.counts.days, 1);
  assert.equal(out.counts.awaitingAfter, 0);
  // Homeowner-level redaction still applies.
  assert.equal('contentHash' in out.videos[0]!, false);
});

test('the sub view says it is the sub view, so a short list is explained', () => {
  const out = partyProofPayload(officePayload, 'party-sub') as unknown as { viewerScope: { role: string } };
  assert.equal(out.viewerScope.role, 'subcontractor');
});

test('sub invites resolve by signed-in email, live rows only, one per job', async () => {
  const rows = [
    { id: 'pa', org_id: 'org-gc', job_id: 'job-1', email: 'Sub@Trade.com', revoked_at: null },
    { id: 'pb', org_id: 'org-gc', job_id: 'job-2', email: 'sub@trade.com', revoked_at: '2026-10-01' },
    { id: 'pc', org_id: 'org-gc', job_id: 'job-1', email: 'sub@trade.com', revoked_at: null },
    { id: 'pd', org_id: 'org-gc', job_id: 'job-3', email: 'other@trade.com', revoked_at: null },
  ];
  type Query = Record<string, (...args: unknown[]) => unknown>;
  const query: Query = {
    select: () => query,
    ilike: () => query,
    is: () => query,
    eq: () => query,
    order: async () => ({ data: rows, error: null }),
  };
  const admin = { from: () => query } as unknown as Parameters<typeof listJobPartyViews>[0];
  const views = await listJobPartyViews(admin, ' SUB@trade.com ');
  assert.deepEqual(views, [{ orgId: 'org-gc', jobId: 'job-1', partyId: 'pa' }]);
  assert.deepEqual(await listJobPartyViews(admin, ''), []);
});


test('an invited sub, like a homeowner, opens every clip on the job (full mirror)', () => {
  assert.equal(viewerPartyId(viewer('party-sub')), null);
  assert.doesNotThrow(() => assertViewerMayOpenProof(viewer('party-sub'), { party_id: 'party-other' }));
  assert.doesNotThrow(() => assertViewerMayOpenProof(viewer('party-sub'), { party_id: null }));
});
