import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assemblePhysicalWorkRecord,
  deriveImmediateOutcome,
  deriveWorldStates,
  exportRights,
  immediateStatusFromVerdicts,
  payloadHash,
  redactEvidenceForView,
  verifiedPhysicalWorkEpisode,
} from '../src/physicalWork/derive.js';
import { ingestPhysicalWorkFromProof } from '../src/physicalWork/ingest.js';
import { summariseEpisodes } from '../src/physicalWork/metrics.js';
import type { EpisodeForDerive, ProofForDerive } from '../src/physicalWork/types.js';

const beforeAfterProofs: ProofForDerive[] = [
  {
    id: 'proof-before',
    phase: 'before',
    ai_summary: 'Wet carpet and standing water in the living room.',
    ai_findings: {
      kind: 'before_after',
      cannotTell: ['cavity behind the baseboard'],
      opening: { before: 'exterior', after: 'not_exterior' },
    },
    ai_model: 'claude-test',
    content_hash: 'abc',
    storage_path: 'org/job/before.mp4',
    duration_seconds: 90,
  },
  {
    id: 'proof-after',
    phase: 'after',
    ai_summary: 'Carpet pulled, pad out, flood cut started on the south wall.',
    ai_material_change: 'significant',
    ai_findings: {
      kind: 'before_after',
      changes: ['carpet removed', 'flood cut on south wall'],
      workPerformed: ['carpet removed', 'flood cut on south wall'],
      cannotTell: ['whether the cavity is dry'],
      concerns: ['cut may be below the water line'],
      scopeTouched: ['Extract standing water', 'Flood cut'],
      scopeVerdicts: [
        { title: 'Extract standing water', verdict: 'appears_complete', because: 'No standing water in after frames.' },
        { title: 'Flood cut', verdict: 'in_progress', because: 'South wall is open; run not finished.' },
      ],
      opening: { before: 'exterior', after: 'not_exterior' },
    },
    ai_model: 'claude-test',
    content_hash: 'def',
    storage_path: 'org/job/after.mp4',
    duration_seconds: 140,
    actions: [{ objectLabel: 'drywall', objects: ['drywall', 'carpet'] }],
  },
];

test('before/after proofs become two world states without inventing a third', () => {
  const { before, after } = deriveWorldStates(beforeAfterProofs);
  assert.ok(before);
  assert.ok(after);
  assert.equal(before!.sourceProofId, 'proof-before');
  assert.equal(after!.sourceProofId, 'proof-after');
  assert.equal(before!.opening, 'exterior');
  assert.equal(after!.opening, 'not_exterior');
  assert.ok(after!.changes.includes('carpet removed'));
  assert.ok(after!.uncertainties.some((u) => /cavity/i.test(u)));
  assert.equal(before!.changes.length, 0, 'the before state is the place, not the work');
});

test('a single day film still produces an after reading', () => {
  const { before, after } = deriveWorldStates([
    {
      id: 'film',
      phase: 'after',
      ai_summary: 'Air movers running in the living room.',
      ai_findings: {
        kind: 'day_film',
        workPerformed: ['equipment placed and running'],
        opening: { before: 'unclear', after: 'not_exterior' },
      },
    },
  ]);
  assert.ok(after);
  assert.equal(after!.sourceProofId, 'film');
  assert.equal(after!.opening, 'not_exterior');
  assert.ok(after!.changes.includes('equipment placed and running'));
  assert.ok(before, 'the same film can seed a before snapshot when it has substance');
});

test('immediate outcome is AI and mixed when scope lines disagree', () => {
  const outcome = deriveImmediateOutcome(beforeAfterProofs);
  assert.ok(outcome);
  assert.equal(outcome!.status, 'mixed');
  assert.equal(outcome!.isGroundTruth, false);
  assert.equal(outcome!.materialChange, 'significant');
  assert.equal(outcome!.scopeVerdicts.length, 2);
});

test('immediateStatusFromVerdicts does not treat empty as complete', () => {
  assert.equal(immediateStatusFromVerdicts([], null), 'unknown');
  assert.equal(immediateStatusFromVerdicts([], 'significant'), 'changed');
  assert.equal(
    immediateStatusFromVerdicts([{ title: 'A', verdict: 'not_visible', because: null }], null),
    'not_visible',
  );
  assert.equal(
    immediateStatusFromVerdicts(
      [
        { title: 'A', verdict: 'appears_complete', because: null },
        { title: 'B', verdict: 'appears_complete', because: null },
      ],
      null,
    ),
    'appears_complete',
  );
});

test('job_only export redacts media locators and is not training-eligible', () => {
  const rights = exportRights('job_only', 'not_asked');
  assert.equal(rights.view, 'operational');
  assert.equal(rights.trainingEligible, false);
  const redacted = redactEvidenceForView(
    [{ proofId: 'p', kind: 'video', phase: 'after', contentHash: 'abc', storagePath: 'x', durationSeconds: 1, byteSize: 2, capturedAt: null }],
    rights.view,
  );
  assert.equal(redacted[0]!.contentHash, null);
  assert.equal(redacted[0]!.storagePath, null);

  const licensable = exportRights('licensable', 'granted');
  assert.equal(licensable.view, 'training');
  assert.equal(licensable.trainingEligible, true);
});

test('training export JSON carries the day as a record, not as footage hours', () => {
  const episode: EpisodeForDerive = {
    id: 'ep-1',
    job_id: 'job-1',
    org_id: 'org-1',
    work_date: '2026-08-20',
    task_key: 'mit.demolition.flood_cut',
    trade: 'Water mitigation',
    intent_note: 'Flood cut the south wall.',
    performer_label: 'Rivera Restoration',
    performer_kind: 'human',
    data_rights: 'job_only',
    worker_consent: 'not_asked',
    tier: 2,
    status: 'in_progress',
  };
  const record = assemblePhysicalWorkRecord({
    episode,
    proofs: beforeAfterProofs,
    actions: [
      {
        sequence: 1,
        action: 'remove',
        object_label: 'drywall',
        tool_label: 'utility knife',
        material_label: null,
        purpose: 'Pulling wet board.',
        label_source: 'ai',
        confidence: 0.9,
      },
    ],
    verifications: [{ kind: 'ai_analysis', result: 'inconclusive', detail: 'Model only.' }],
    outcomes: [],
  });

  assert.equal(record.schema, 'atmosphere.physical_work.v1');
  assert.equal(record.episodeId, 'ep-1');
  assert.equal(record.goal.taskName, 'Flood cut and remove wet drywall');
  assert.ok(record.goal.expectedActions.includes('cut'));
  assert.equal(record.actions[0]!.action, 'remove');
  assert.equal(record.tools[0]!.name, 'utility knife');
  assert.equal(record.outcome?.isGroundTruth, false);
  assert.equal(record.verification[0]!.isGroundTruth, false);
  assert.equal(record.rights.trainingEligible, false);
  assert.equal(record.evidence[0]!.storagePath, null);
});

test('dataset summary counts verified physical-work episodes, not video hours', () => {
  const summary = summariseEpisodes(
    [
      { tier: 1, data_rights: 'job_only', worker_consent: 'not_asked', trade: 'Water mitigation' },
      { tier: 2, data_rights: 'licensable', worker_consent: 'granted', trade: 'Water mitigation' },
      { tier: 3, data_rights: 'org_analytics', worker_consent: 'granted', trade: 'Plumbing' },
    ],
    {
      worldStateEpisodeIds: new Set(['a', 'b']),
      immediateOutcomeIds: new Set(['b']),
    },
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.verifiedPhysicalWorkEpisodes, 2);
  assert.equal(summary.trainingEligible, 1);
  assert.equal(summary.withWorldState, 2);
  assert.equal(summary.licensable, 1);
  assert.equal(verifiedPhysicalWorkEpisode({ tier: 1 }), false);
  assert.equal(verifiedPhysicalWorkEpisode({ tier: 2 }), true);
});

test('payloadHash is stable so a re-ingest does not invent a second annotation', () => {
  assert.equal(payloadHash({ a: 1 }), payloadHash({ a: 1 }));
  assert.notEqual(payloadHash({ a: 1 }), payloadHash({ a: 2 }));
});

function memoryAdmin(tables: Record<string, unknown[]>) {
  const writes: Array<{ table: string; op: string; row: unknown }> = [];
  return {
    writes,
    from(table: string) {
      const rows = () => (tables[table] ??= []);
      const chain = (filters: Array<(row: any) => boolean> = []) => {
        const filtered = () => rows().filter((row) => filters.every((fn) => fn(row)));
        const api: any = {
          select() {
            return api;
          },
          eq(col: string, value: unknown) {
            return chain([...filters, (row) => row[col] === value]);
          },
          in(col: string, values: unknown[]) {
            return chain([...filters, (row) => values.includes(row[col])]);
          },
          order() {
            return api;
          },
          maybeSingle: async () => ({ data: filtered()[0] ?? null }),
          then(resolve: (value: { data: unknown[] }) => unknown) {
            return Promise.resolve({ data: filtered() }).then(resolve);
          },
        };
        return api;
      };
      return {
        ...chain(),
        upsert(row: any) {
          writes.push({ table, op: 'upsert', row });
          rows().push(row);
          return Promise.resolve({ error: null });
        },
        insert(row: any) {
          writes.push({ table, op: 'insert', row });
          rows().push(row);
          return Promise.resolve({ error: null });
        },
        update() {
          return { eq: async () => ({ error: null }) };
        },
        delete() {
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      };
    },
  };
}

test('ingest writes world state, evidence, annotation and day outcome without throwing', async () => {
  const admin = memoryAdmin({
    episode_observations: [{ episode_id: 'ep-1', proof_id: 'proof-after' }],
    work_episodes: [
      {
        id: 'ep-1',
        org_id: 'org-1',
        job_id: 'job-1',
        work_date: '2026-08-20',
        data_rights: 'job_only',
        worker_consent: 'not_asked',
        tier: 1,
        status: 'in_progress',
      },
    ],
    job_proofs: beforeAfterProofs,
    episode_actions: [
      { episode_id: 'ep-1', action: 'remove', tool_label: 'utility knife', sequence: 1 },
    ],
    episode_resources: [],
    episode_verifications: [],
    episode_outcomes: [],
    episode_annotations: [],
    episode_world_states: [],
    episode_evidence_assets: [],
    episode_immediate_outcomes: [],
  });

  const episodeId = await ingestPhysicalWorkFromProof(admin, { orgId: 'org-1', proofId: 'proof-after' });
  assert.equal(episodeId, 'ep-1');
  assert.ok(admin.writes.some((w) => w.table === 'episode_world_states'));
  assert.ok(admin.writes.some((w) => w.table === 'episode_evidence_assets'));
  assert.ok(admin.writes.some((w) => w.table === 'episode_immediate_outcomes'));
  assert.ok(admin.writes.some((w) => w.table === 'episode_annotations'));
  const outcome = admin.writes.find((w) => w.table === 'episode_immediate_outcomes')?.row as {
    is_ground_truth: boolean;
    status: string;
  };
  assert.equal(outcome.is_ground_truth, false);
  assert.equal(outcome.status, 'mixed');
});

test('ingest returns null and does not throw when the proof is not on an episode', async () => {
  const admin = memoryAdmin({
    episode_observations: [],
    work_episodes: [],
  });
  const result = await ingestPhysicalWorkFromProof(admin, { orgId: 'org-1', proofId: 'missing' });
  assert.equal(result, null);
});
