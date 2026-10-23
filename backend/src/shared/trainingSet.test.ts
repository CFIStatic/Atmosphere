import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExamples, collectTrainingSet, hasProtectedMoments, namesToHide, scrubText, type ClipRow, type FeedbackRow } from './trainingSet.js';

type Call = { table: string; ops: Array<[string, unknown[]]> };
type Chain = { [method: string]: (...args: unknown[]) => Chain } & PromiseLike<unknown>;

/** A chainable stand-in for the Supabase client: records every call, answers per table. */
function fakeDb(answers: Record<string, unknown | ((call: Call) => unknown)>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const result = () => {
        const a = answers[table];
        return Promise.resolve(typeof a === 'function' ? (a as (c: Call) => unknown)(call) : (a ?? { data: null, error: null }));
      };
      const chain = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej);
            return (...args: unknown[]) => {
              call.ops.push([prop, args]);
              return chain;
            };
          },
        },
      ) as Chain;
      return chain;
    },
  };
  return { db, calls };
}

const has = (call: Call, op: string, ...args: unknown[]) => call.ops.some(([o, a]) => o === op && JSON.stringify(a.slice(0, args.length)) === JSON.stringify(args));
const feedback = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id: 'f1', org_id: 'o1', job_id: 'j1', proof_id: 'p1', rating: 1, reason: null,
  ai_text: 'Maria Lopez agreed to dry the kitchen.', ai_model: 'claude-haiku-4-5', corrected_text: null, ...over,
});
const clip = (over: Partial<ClipRow> = {}): ClipRow => ({
  id: 'p1', transcript_text: 'Maria, call me at 414-555-0199 about 123 Oak Street.', phase: 'before', duration_seconds: 42, ai_findings: {}, ...over,
});

test('scrubText hides known names, emails, phones and street addresses', () => {
  const hide = namesToHide(['Maria Lopez', 'Delgado Roofing LLC']);
  const out = scrubText('Maria Lopez from Delgado Roofing LLC: maria@x.com, (414) 555-0199, 123 Oak Street. Lopez said ok.', hide);
  assert.equal(out, '[NAME] from [NAME]: [EMAIL], [PHONE], [ADDRESS] [NAME] said ok.');
  assert.ok(!hide.includes('Roofing'), 'trade words are not hidden on their own');
});

test('clips with a child or private moment never become examples', () => {
  assert.equal(hasProtectedMoments({ childPrivacyRedactions: { ranges: [{ startSec: 1, endSec: 2 }] } }), true);
  assert.equal(hasProtectedMoments({ privacyRedactions: { ranges: [] } }), false);
  assert.deepEqual(buildExamples(feedback(), clip({ ai_findings: { childPrivacyRedactions: { ranges: [{}] } } }), []), { skipped: 'protected_moments' });
});

test('a thumbs up becomes a training example; a thumbs down without a fix becomes nothing', () => {
  const up = buildExamples(feedback(), clip(), namesToHide(['Maria Lopez']));
  assert.equal(up.sft?.meta.source, 'approved');
  assert.equal(up.preference, undefined);
  assert.equal(up.sft?.messages[2]?.content, '[NAME] agreed to dry the kitchen.');
  assert.match(up.sft!.messages[1]!.content, /\[PHONE\] about \[ADDRESS\]/);
  assert.deepEqual(buildExamples(feedback({ rating: -1 }), clip(), []), { skipped: 'thumbs_down_without_fix' });
  assert.deepEqual(buildExamples(feedback(), clip({ transcript_text: '  ' }), []), { skipped: 'no_transcript' });
});

test('a correction becomes a training example and a preference pair (fix beats AI text)', () => {
  const out = buildExamples(feedback({ rating: -1, reason: 'wrong', corrected_text: 'The homeowner declined drying.' }), clip(), []);
  assert.equal(out.sft?.meta.source, 'correction');
  assert.equal(out.sft?.messages[2]?.content, 'The homeowner declined drying.');
  assert.equal(out.preference?.chosen, 'The homeowner declined drying.');
  assert.equal(out.preference?.rejected, 'Maria Lopez agreed to dry the kitchen.');
  assert.equal(out.preference?.meta.split, out.sft?.meta.split);
});

test('every clip of one job lands in the same split', () => {
  const a = buildExamples(feedback({ id: 'f1', proof_id: 'p1' }), clip(), []);
  const b = buildExamples(feedback({ id: 'f2', proof_id: 'p2' }), clip({ id: 'p2' }), []);
  assert.equal(a.sft?.meta.split, b.sft?.meta.split);
  assert.notEqual(a.sft?.meta.exampleId, b.sft?.meta.exampleId);
});

test('collectTrainingSet reads nothing when no workspace has feedback', async () => {
  const { db, calls } = fakeDb({ clip_summary_feedback: { data: [], error: null } });
  const out = await collectTrainingSet(db);
  assert.equal(out.orgsOptedIn, 0);
  assert.deepEqual(calls.map((c) => c.table), ['clip_summary_feedback']);
});

test('collectTrainingSet reads every workspace with feedback, ignores the old opt-in table, and never asks for media', async () => {
  const { db, calls } = fakeDb({
    clip_summary_feedback: { data: [feedback()], error: null },
    job_proofs: { data: [clip()], error: null },
    job_parties: { data: [{ company: 'Delgado Roofing', contact_name: 'Maria Lopez' }], error: null },
    crm_jobs: { data: [{ title: 'Lopez kitchen', claim_number: null, policy_number: null }], error: null },
    speaker_identities: { data: [], error: null },
    org_members: { data: [], error: null },
    orgs: { data: { name: 'Jettx LLC' }, error: null },
  });
  const out = await collectTrainingSet(db);
  assert.equal(out.sft.length, 1);
  assert.equal(out.sft[0]!.messages[2]!.content, '[NAME] agreed to dry the kitchen.');
  assert.equal(calls.some((c) => c.table === 'org_ai_training_settings'), false);
  assert.ok(calls.some((c) => c.table === 'clip_summary_feedback' && has(c, 'eq', 'org_id', 'o1')));
  const clipSelect = calls.find((c) => c.table === 'job_proofs')!.ops.find(([o]) => o === 'select')![1][0] as string;
  assert.doesNotMatch(clipSelect, /storage_path|frame/);
});
