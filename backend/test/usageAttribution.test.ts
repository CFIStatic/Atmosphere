/* eslint-disable @typescript-eslint/no-explicit-any */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeLedgerRow,
  ledgerClipHints,
  loadAttributionLookups,
  pickUsageActor,
  resolveUsageActor,
} from '../src/metering/usageAttribution.js';
import { withVideoUsageScope } from '../src/metering/backgroundUsage.js';
import { currentAiUsageScope } from '../src/metering/aiUsageContext.js';
import {
  aggregateTokenUsage,
  attributeUnownedRows,
  recordTokenUsage,
  type TokenUsageEventRow,
} from '../src/metering/tokenUsage.js';

test('pickUsageActor prefers uploader, then party inviter, then job owner', () => {
  assert.equal(pickUsageActor({}), null);
  assert.equal(pickUsageActor({ jobCreatedBy: 'creator' }), 'creator');
  assert.equal(pickUsageActor({ jobOwnerId: 'owner', jobCreatedBy: 'creator' }), 'owner');
  assert.equal(
    pickUsageActor({
      partyCreatedBy: 'inviter',
      jobOwnerId: 'owner',
      jobCreatedBy: 'creator',
    }),
    'inviter',
  );
  assert.equal(
    pickUsageActor({
      uploaderId: 'uploader',
      partyCreatedBy: 'inviter',
      jobOwnerId: 'owner',
    }),
    'uploader',
  );
  assert.equal(
    pickUsageActor({
      userId: 'signed-in',
      uploaderId: 'uploader',
    }),
    'signed-in',
  );
});

function tableClient(tables: Record<string, Record<string, unknown> | null>) {
  return {
    from(table: string) {
      const row = tables[table] ?? null;
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return api;
    },
  };
}

test('resolveUsageActor uses the video uploader when present', async () => {
  const userId = await resolveUsageActor(
    tableClient({
      verification_videos: { uploader_id: 'jack', party_id: 'party-1', job_id: 'job-1' },
      job_parties: { created_by: 'inviter' },
      crm_jobs: { owner_id: 'owner', created_by: 'creator' },
    }),
    { orgId: 'org-1', videoId: 'vid-1' },
  );
  assert.equal(userId, 'jack');
});

test('resolveUsageActor falls back to the party inviter, then the job owner', async () => {
  const fromParty = await resolveUsageActor(
    tableClient({
      verification_videos: { uploader_id: null, party_id: 'party-1', job_id: 'job-1' },
      job_parties: { created_by: 'inviter' },
      crm_jobs: { owner_id: 'owner', created_by: 'creator' },
    }),
    { orgId: 'org-1', videoId: 'vid-1', jobId: 'job-1', partyId: 'party-1' },
  );
  assert.equal(fromParty, 'inviter');

  const fromJob = await resolveUsageActor(
    tableClient({
      verification_videos: { uploader_id: null, party_id: null, job_id: 'job-1' },
      job_parties: null,
      crm_jobs: { owner_id: 'owner', created_by: 'creator' },
    }),
    { orgId: 'org-1', jobId: 'job-1' },
  );
  assert.equal(fromJob, 'owner');
});

test('resolveUsageActor stays null when no uploader, party, or job owner exists', async () => {
  const userId = await resolveUsageActor(
    tableClient({
      verification_videos: { uploader_id: null, party_id: null, job_id: null },
      job_parties: null,
      crm_jobs: { owner_id: null, created_by: null },
    }),
    { orgId: 'org-1', videoId: 'vid-1' },
  );
  assert.equal(userId, null);
});

test('resolveUsageActor never throws when a lookup fails', async () => {
  const userId = await resolveUsageActor(
    {
      from() {
        throw new Error('db down');
      },
    },
    { orgId: 'org-1', videoId: 'vid-1', jobId: 'job-1' },
  );
  assert.equal(userId, null);
});

// ---------------------------------------------------------------------------
// Video analysis that ran in the background (service role, no signed-in seat).
// Production shape: Field Capture upload → job_proofs row, linked to a
// verification_videos row with uploader_id; the capture party was created by
// the same Global Admin; crm_jobs.owner_id is null.
// ---------------------------------------------------------------------------

const ORG = '8b2cc105-0000-4000-8000-00000000000a';
const JACK = '11183200-0000-4000-8000-000000000001';
const ADMIN = '11183200-0000-4000-8000-000000000002';
const PROOF = '626d2992-6f45-49af-9e88-3035324bd12c';
const PROOF_NO_LINK = 'e07e8fee-874c-467d-8322-93e01ba8928f';
const PARTY = '0efe178d-7e31-464a-a016-0c7a60efc1b4';
const JOB = '9d5c2cc2-4263-4f21-a517-f763b4d8fc0a';
const RUN = '45475ab0-5681-4af0-bf04-e1d5fbb9a8cb';

type Row = Record<string, unknown>;

/** Filters honoured (eq / in), so a wrong join key really misses. */
function dbClient(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
        in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: any, reject: any) =>
          Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      };
      return q;
    },
  } as any;
}

const PROD_SHAPE: Record<string, Row[]> = {
  verification_videos: [
    { id: 'vv-1', org_id: ORG, proof_id: PROOF, uploader_id: JACK, party_id: PARTY, job_id: JOB },
  ],
  job_proofs: [
    { id: PROOF, org_id: ORG, party_id: PARTY, job_id: JOB },
    { id: PROOF_NO_LINK, org_id: ORG, party_id: PARTY, job_id: JOB },
  ],
  job_parties: [{ id: PARTY, org_id: ORG, created_by: JACK, company: 'Field Capture' }],
  crm_jobs: [{ id: JOB, org_id: ORG, owner_id: null, created_by: JACK }],
};

test('pickUsageActor uses the triggering admin only after uploader and job owner', () => {
  assert.equal(pickUsageActor({ triggeredBy: ADMIN }), ADMIN);
  assert.equal(pickUsageActor({ jobOwnerId: 'owner', triggeredBy: ADMIN }), 'owner');
  assert.equal(pickUsageActor({ uploaderId: JACK, triggeredBy: ADMIN }), JACK);
});

test('resolveUsageActor finds the uploader from a Field Capture proof id', async () => {
  assert.equal(await resolveUsageActor(dbClient(PROD_SHAPE), { orgId: ORG, proofId: PROOF }), JACK);
});

test('resolveUsageActor: proof with no verification link → party inviter → job → triggering admin', async () => {
  assert.equal(
    await resolveUsageActor(dbClient(PROD_SHAPE), { orgId: ORG, proofId: PROOF_NO_LINK }),
    JACK,
  );
  const ownerless = {
    ...PROD_SHAPE,
    job_parties: [{ id: PARTY, org_id: ORG, created_by: null }],
    crm_jobs: [{ id: JOB, org_id: ORG, owner_id: 'owner-1', created_by: JACK }],
  };
  assert.equal(
    await resolveUsageActor(dbClient(ownerless), { orgId: ORG, proofId: PROOF_NO_LINK }),
    'owner-1',
  );
  const nobody = { verification_videos: [], job_proofs: [], job_parties: [], crm_jobs: [] };
  assert.equal(
    await resolveUsageActor(dbClient(nobody), { orgId: ORG, proofId: PROOF, triggeredBy: ADMIN }),
    ADMIN,
  );
  assert.equal(await resolveUsageActor(dbClient(nobody), { orgId: ORG, proofId: PROOF }), null);
});

test('resolveUsageActor never crosses orgs', async () => {
  assert.equal(
    await resolveUsageActor(dbClient(PROD_SHAPE), {
      orgId: 'other-org',
      proofId: PROOF,
      jobId: JOB,
    }),
    null,
  );
});

test('withVideoUsageScope names the uploader on the background metering scope', async () => {
  let seen: string | null | undefined;
  await withVideoUsageScope(
    dbClient(PROD_SHAPE),
    { proofId: PROOF, orgId: ORG, jobId: JOB, partyId: PARTY },
    async () => {
      seen = currentAiUsageScope()?.userId;
    },
  );
  assert.equal(seen, JACK);
});

test('withVideoUsageScope falls back to the admin who pressed re-analyse', async () => {
  let seen: string | null | undefined;
  const empty = dbClient({});
  await withVideoUsageScope(empty, { proofId: PROOF, orgId: ORG, triggeredBy: ADMIN }, async () => {
    seen = currentAiUsageScope()?.userId;
  });
  assert.equal(seen, ADMIN);
});

test('ledgerClipHints reads the clip from production request ids', () => {
  assert.equal(
    ledgerClipHints(`background_completion:video:${PROOF}:${RUN}:${RUN}`).proofId,
    PROOF,
  );
  assert.equal(ledgerClipHints(`proof_analysis:video:${PROOF}:${RUN}:${RUN}`).proofId, PROOF);
  assert.equal(ledgerClipHints(`whisper:${PROOF}`).proofId, PROOF);
  const safety = ledgerClipHints(`safety_vision:safety:${PARTY}:${RUN}:${RUN}`);
  assert.equal(safety.partyId, PARTY);
  assert.equal(safety.proofId, null);
  assert.equal(ledgerClipHints('video_analysis:run-1', { videoId: 'not-a-uuid' }).videoId, null);
  assert.equal(ledgerClipHints('ask:job-1').proofId, null);
});

function ledgerRow(over: Partial<TokenUsageEventRow>): TokenUsageEventRow {
  return {
    id: over.id ?? 'e',
    orgId: ORG,
    userId: null,
    jobId: JOB,
    requestId: 'req',
    feature: 'video_analysis',
    source: 'background_completion',
    modelId: 'claude-opus-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    totalTokens: 0,
    costNanos: 0,
    priceNanos: 0,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

test('By employee: stored unattributed video rows land on the uploader, not Unattributed (System)', async () => {
  const rows: TokenUsageEventRow[] = [
    ledgerRow({
      id: 'v1',
      requestId: `background_completion:video:${PROOF}:${RUN}:${RUN}`,
      totalTokens: 358_864,
      inputTokens: 358_864,
    }),
    ledgerRow({
      id: 'v2',
      requestId: `video_dictation:video:${PROOF_NO_LINK}:${RUN}:${RUN}`,
      source: 'video_dictation',
      totalTokens: 118_734,
      inputTokens: 118_734,
    }),
    ledgerRow({
      id: 'v3',
      requestId: `safety_vision:safety:${PARTY}:${RUN}:${RUN}`,
      source: 'safety_vision',
      totalTokens: 4_761,
      inputTokens: 4_761,
    }),
    ledgerRow({ id: 'w1', requestId: `whisper:${PROOF}`, source: 'whisper', totalTokens: 0 }),
    // Already owned: untouched.
    ledgerRow({
      id: 'c1',
      userId: JACK,
      feature: 'chat',
      source: 'proof_ask',
      requestId: 'ask:1',
      totalTokens: 451_000,
      inputTokens: 451_000,
    }),
    // Nothing to join on: stays Unattributed.
    ledgerRow({
      id: 'x1',
      jobId: null,
      requestId: 'video_analysis:orphan',
      totalTokens: 10,
      inputTokens: 10,
    }),
  ];
  const client = dbClient(PROD_SHAPE);
  const attributed = await attributeUnownedRows(client, ORG, rows);
  assert.deepEqual(
    attributed.map((r) => [r.id, r.userId]),
    [
      ['v1', JACK],
      ['v2', JACK],
      ['v3', JACK],
      ['w1', JACK],
      ['c1', JACK],
      ['x1', null],
    ],
  );
  const now = new Date().toISOString();
  const report = aggregateTokenUsage(attributed, { start: now, end: now }, [
    { userId: JACK, fullName: 'El Presidente', email: 'jack@jettx.ai', role: 'global_admin' },
  ]);
  const jack = report.byEmployee.find((e) => e.userId === JACK)!;
  assert.equal(jack.byFeature.video_analysis.totalTokens, 358_864 + 118_734 + 4_761);
  const system = report.byEmployee.find((e) => e.userId === null)!;
  assert.equal(system.totalTokens, 10);
});

test('attributeLedgerRow uses metadata.videoId for verification-pipeline rows', async () => {
  const rows = [
    ledgerRow({
      id: 'p1',
      requestId: 'video_analysis:run-9',
      metadata: { videoId: '5a5a5a5a-0000-4000-8000-000000000001' },
    }),
  ];
  const client = dbClient({
    verification_videos: [
      {
        id: '5a5a5a5a-0000-4000-8000-000000000001',
        org_id: ORG,
        proof_id: null,
        uploader_id: 'uploader-2',
        party_id: null,
        job_id: JOB,
      },
    ],
    crm_jobs: [{ id: JOB, org_id: ORG, owner_id: 'owner-1', created_by: JACK }],
  });
  const lookups = await loadAttributionLookups(client, ORG, rows);
  assert.equal(attributeLedgerRow(rows[0]!, lookups), 'uploader-2');
});

test('attributeUnownedRows never fails the report when lookups error', async () => {
  const rows = [ledgerRow({ id: 'v1', requestId: `background_completion:video:${PROOF}:${RUN}` })];
  const broken = {
    from() {
      throw new Error('permission denied');
    },
  } as any;
  const out = await attributeUnownedRows(broken, ORG, rows);
  assert.equal(out[0]!.userId, null);
});

test('recordTokenUsage stores the uploader on a video row written with no seat (Whisper)', async () => {
  const rpcs: Array<Record<string, unknown>> = [];
  const client = {
    ...dbClient(PROD_SHAPE),
    rpc: async (_name: string, params: Record<string, unknown>) => {
      rpcs.push(params);
      return { data: { eventId: 'evt-1', duplicate: true }, error: null };
    },
  } as any;
  await recordTokenUsage(client, {
    orgId: ORG,
    requestId: `whisper:${PROOF}`,
    feature: 'video_analysis',
    source: 'whisper',
    jobId: JOB,
    costNanos: 0,
    metadata: { proofId: PROOF },
  });
  assert.equal(rpcs[0]?.p_user_id, JACK);

  // Chat rows are never re-attributed.
  await recordTokenUsage(client, {
    orgId: ORG,
    requestId: 'ask-1',
    feature: 'ask',
    jobId: JOB,
    costNanos: 0,
  });
  assert.equal(rpcs[1]?.p_user_id, null);
});
