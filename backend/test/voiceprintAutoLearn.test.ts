/* eslint-disable @typescript-eslint/no-explicit-any */
import test from 'node:test';
import assert from 'node:assert/strict';
import { blendEmbedding, settledSpeakers, learnVoiceprintsFromClip } from '../src/audio/voiceprintLearn.js';
import { voiceConsentFromRows, VOICE_CONSENT_VERSION, VOICE_CONSENT_PREFIX } from '../src/legal/voiceConsent.js';

const members = [
  { userId: 'u1', fullName: 'Marco Diaz' },
  { userId: 'u2', fullName: 'Ana Lee' },
  { userId: 'u3', fullName: 'Ana Lee' },
];

test('consent version is not a Terms revision', () => {
  assert.ok(VOICE_CONSENT_VERSION.startsWith(VOICE_CONSENT_PREFIX));
});

test('consent status: none prompts, recorded is consented, revoked never re-prompts', () => {
  assert.deepEqual(voiceConsentFromRows(null, null), { consented: false, consentedAt: null, revoked: false, required: true });
  assert.equal(voiceConsentFromRows({ accepted_at: '2026-10-23T00:00:00Z' }, null).consented, true);
  const revoked = voiceConsentFromRows(null, { action: 'revoked' });
  assert.equal(revoked.required, false);
  assert.equal(revoked.revoked, true);
});

test('settled speakers tie to members by subject or a unique name only', () => {
  const out = settledSpeakers(
    [
      { speaker_label: 'Speaker A', display_name: 'marco diaz', status: 'confirmed', method: 'user' },
      { speaker_label: 'Speaker B', display_name: 'Ana Lee', status: 'confirmed', method: 'user' },
      { speaker_label: 'Speaker C', display_name: 'Someone', status: 'pending', method: 'voice_medium', subject_user_id: 'u2' },
      { speaker_label: 'Speaker D', display_name: 'X', status: 'pending', method: 'voice_high', subject_user_id: 'u2' },
    ],
    members,
  );
  assert.deepEqual(out, [
    { speakerLabel: 'Speaker A', userId: 'u1' },
    { speakerLabel: 'Speaker D', userId: 'u2' },
  ]);
});

test('a label claimed by two people is skipped', () => {
  const out = settledSpeakers(
    [
      { speaker_label: 'Speaker A', status: 'confirmed', method: 'user', subject_user_id: 'u1' },
      { speaker_label: 'speaker a', status: 'confirmed', method: 'voice_high', subject_user_id: 'u2' },
    ],
    members,
  );
  assert.deepEqual(out, []);
});

test('blend refuses a voice that does not match the stored print', () => {
  assert.equal(blendEmbedding([1, 0], [0, 1], 0.72), null);
  const blended = blendEmbedding([1, 0], [0.9, 0.1], 0.72)!;
  assert.ok(blended[0]! > 0.99);
  assert.deepEqual(blendEmbedding([], [0, 1], 0.72), [0, 1]);
});

/** Minimal chainable fake: records writes, answers selects from fixtures. */
function fakeAdmin(fixtures: Record<string, unknown[]>) {
  const writes: string[] = [];
  const from = (table: string) => {
    const q: any = {
      _table: table,
      select: () => q,
      eq: () => q,
      in: () => q,
      lt: () => q,
      not: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: (fixtures[table] ?? [])[0] ?? null, error: null }),
      single: async () => ({ data: (fixtures[table] ?? [])[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: fixtures[table] ?? [], error: null }),
      insert: () => {
        writes.push(`insert:${table}`);
        return q;
      },
      upsert: () => {
        writes.push(`upsert:${table}`);
        return q;
      },
      update: () => {
        writes.push(`update:${table}`);
        return q;
      },
      delete: () => {
        writes.push(`delete:${table}`);
        return q;
      },
    };
    return q;
  };
  return { admin: { from }, writes };
}

test('never enrolls a confirmed speaker without recorded consent', async () => {
  const { admin, writes } = fakeAdmin({
    job_proofs: [{ id: 'p1', org_id: 'o1', job_id: 'j1', storage_path: 's', transcript_text: '[00:01] Speaker A: hi', duration_seconds: 10 }],
    speaker_identities: [{ speaker_label: 'Speaker A', display_name: 'Marco Diaz', status: 'confirmed', method: 'user' }],
    org_members: [{ user_id: 'u1', profiles: { full_name: 'Marco Diaz' } }],
    terms_acceptances: [],
  });
  await learnVoiceprintsFromClip(admin, 'p1');
  assert.deepEqual(
    writes.filter((w) => w !== 'delete:voiceprints'),
    [],
  );
});
