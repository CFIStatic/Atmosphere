/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A homeowner on a shared job sees every live clip on it: the company's
 * crews, a subcontractor from another company filming by invite, and office
 * uploads. Also when the homeowner's email has a workspace of its own.
 * Runs the real library + job-file code paths against an in-memory database.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { viewerLibraryPayload } from '../src/routes/evidencePortal.js';
import { buildJobProofPayload } from '../src/routes/proofOfWork.js';
import { homeownerProofPayload, partyProofPayload } from '../src/shared/homeownerProofPayload.js';

type Row = Record<string, any>;

function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let single: 'one' | 'maybe' | null = null;
    let lim: number | null = null;
    let mode: 'select' | 'write' = 'select';
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      not: (c: string, _op: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), b),
      ilike: (c: string, v: string) => (
        filters.push((r) => String(r[c] ?? '').toLowerCase() === v.replace(/\\(.)/g, '$1').toLowerCase()), b
      ),
      gte: () => b,
      lte: () => b,
      order: () => b,
      limit: (n: number) => ((lim = n), b),
      range: (a: number, z: number) => ((lim = z - a + 1), b),
      maybeSingle: () => ((single = 'maybe'), b),
      single: () => ((single = 'one'), b),
      upsert: () => ((mode = 'write'), b),
      update: () => ((mode = 'write'), b),
      insert: () => ((mode = 'write'), b),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (lim != null) rows = rows.slice(0, lim);
        const data = mode === 'write' ? null : single ? (rows[0] ?? null) : rows;
        return Promise.resolve({ data, error: null }).then(ok, bad);
      },
    };
    return b;
  };
  return { from, storage: { from: () => ({ createSignedUrl: async () => ({ data: null }), createSignedUrls: async () => ({ data: [] }) }) } } as any;
}

const GC = 'org-gc';
const SUB_ORG = 'org-sub';
const HOME_ORG = 'org-homeowner-own';
const JOB = 'job-1';

function clip(id: string, partyId: string | null, extra: Row = {}): Row {
  return {
    id,
    org_id: GC,
    job_id: JOB,
    party_id: partyId,
    work_date: '2026-10-10',
    phase: 'after',
    received_at: `2026-10-10T1${id.length}:00:00Z`,
    created_at: '2026-10-10T10:00:00Z',
    deleted_at: null,
    ai_summary: `Clip ${id}`,
    ...extra,
  };
}

const db = () =>
  fakeDb({
    crm_jobs: [{ id: JOB, org_id: GC, title: 'Von mour test', job_number: 10, deleted_at: null }],
    orgs: [{ id: GC, name: 'Jettx LLC' }, { id: SUB_ORG, name: 'Sub Co' }, { id: HOME_ORG, name: 'Homeowner own' }],
    job_parties: [
      { id: 'party-crew', org_id: GC, job_id: JOB, email: 'crew@gc.com', company: 'Jettx LLC', revoked_at: null },
      // A sub from another company, invited to film this job.
      { id: 'party-sub', org_id: GC, job_id: JOB, email: 'boss@subco.com', company: 'Sub Co', revoked_at: null },
    ],
    job_proofs: [
      clip('crew-1', 'party-crew'),
      clip('sub-1', 'party-sub'),
      clip('office-1', null), // office upload, no party
      clip('gone', 'party-crew', { deleted_at: '2026-10-10T12:00:00Z' }),
    ],
    verifier_shares: [
      { id: 'share-1', org_id: GC, job_id: JOB, share_kind: 'progress', recipient_email: 'home@example.com', revoked_at: null, expires_at: null, created_at: '2026-10-10' },
    ],
    job_progress_grants: [
      { org_id: GC, job_id: JOB, user_id: 'user-home', share_id: 'share-1', recipient_email: 'home@example.com', revoked_at: null, access_kind: 'homeowner', created_at: '2026-10-10' },
    ],
  });

const LIVE = ['crew-1', 'office-1', 'sub-1'];

test('Dashboard: a homeowner without a workspace lists every live clip (crew, other-company sub, office)', async () => {
  const out = (await viewerLibraryPayload(db(), 'user-home', 'home@example.com')) as any;
  assert.deepEqual(out.items.map((i: Row) => i.id).sort(), LIVE);
});

test('Dashboard: a homeowner whose email has its own workspace still lists every clip', async () => {
  const out = (await viewerLibraryPayload(db(), 'user-home', 'home@example.com', HOME_ORG)) as any;
  assert.deepEqual(out.items.map((i: Row) => i.id).sort(), LIVE);
});

test('Dashboard: the homeowner count equals the contractor count', async () => {
  const contractor = (await buildJobProofPayload(db(), GC, JOB)) as any;
  const home = (await viewerLibraryPayload(db(), 'user-home', 'home@example.com', HOME_ORG)) as any;
  assert.equal(home.items.length, contractor.videos.length);
});

test('Job file Videos tab: the homeowner gets the same clips as the contractor, office data stripped', async () => {
  const contractor = (await buildJobProofPayload(db(), GC, JOB)) as any;
  const home = homeownerProofPayload(contractor) as any;
  assert.deepEqual(contractor.videos.map((v: Row) => v.id).sort(), LIVE);
  assert.deepEqual(home.videos.map((v: Row) => v.id).sort(), LIVE);
  assert.deepEqual(home.disputes, []);
  assert.equal(home.counts.payable, 0);
});

test('Only an invited sub is narrowed to their own clips', async () => {
  const contractor = (await buildJobProofPayload(db(), GC, JOB)) as any;
  const sub = partyProofPayload(contractor, 'party-sub') as any;
  assert.deepEqual(sub.videos.map((v: Row) => v.id), ['sub-1']);
});
