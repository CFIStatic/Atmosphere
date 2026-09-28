import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ambiguitySentence,
  answerFromMentionContext,
  loginNameFromMetadata,
  mentionDisplayName,
  mentionToken,
  MENTION_MODEL_INSTRUCTIONS,
  activitySystemAddendum,
  carryPriorMention,
  stripMentionMarks,
  parseMentions,
  rankMentionItems,
  resolveMentions,
  textMentionsPerson,
  type MentionMember,
} from '../src/shared/mentions.js';
import { fieldCaptureEmail } from '../src/field/crewJoin.js';
import { listJobMentionMembers, loadPersonContext, prepareMentionAsk } from '../src/shared/mentionContext.js';
import { assembleMentionModelPrompt } from '../src/shared/jobFileAsk.js';
import { collectionClipsFromRows } from '../src/shared/proofAnalyst.js';
import { PRIVACY_REDACTED_LABEL } from '../src/audio/privacyRedactions.js';
import { CHILD_PRIVACY_REDACTED_LABEL } from '../src/audio/childPrivacyRedactions.js';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const JOHN = '11111111-1111-4111-8111-111111111111';
const JANE = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';
const JOB_ELEC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB_PLUMB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JOB_OTHER_ORG = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROOF_ELEC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROOF_OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const SMITH = '44444444-4444-4444-8444-444444444444';

function roster(): MentionMember[] {
  return [
    { userId: JOHN, fullName: 'John Cyganiak', email: 'john.cyganiak@example.com' },
    { userId: JANE, fullName: 'Jane Alvarez', email: 'jane@example.com' },
    { userId: SMITH, fullName: 'John Smith', email: 'jsmith@example.com' },
  ];
}

test('mention parsing keeps structured ids and bare names, including several in one message', () => {
  const text = `${mentionToken('John Cyganiak', JOHN)} did he finish, and @Jane too?`;
  const parsed = parseMentions(text);
  assert.deepEqual(
    parsed.map((mention) => mention.raw),
    ['John Cyganiak', 'Jane'],
  );
  assert.equal(parsed[0]?.claimedUserId, JOHN);
  assert.equal(parsed[1]?.claimedUserId, null);
  assert.equal(parseMentions('email john@example.com is not a mention').length, 0);
});

test('names come from the profile, then the login, and match without a username', () => {
  assert.equal(mentionDisplayName({ fullName: 'John Cyganiak', loginName: 'Other' }), 'John Cyganiak');
  assert.equal(mentionDisplayName({ fullName: '  ', loginName: 'Jane Alvarez' }), 'Jane Alvarez');
  assert.equal(loginNameFromMetadata({ name: 'Fallback', full_name: 'From Google' }), 'From Google');
  assert.equal(loginNameFromMetadata({ name: 'From Google' }), 'From Google');

  const members = roster();
  const compact = resolveMentions('@johncyganiak did he finish the electrical job?', members);
  assert.equal(compact.mentions[0]?.userId, JOHN);
  assert.equal(compact.mentions[0]?.name, 'John Cyganiak');
  assert.equal(compact.ambiguous.length, 0);

  const spaced = resolveMentions('@John Cyganiak did he finish?', members);
  assert.equal(spaced.mentions[0]?.userId, JOHN);

  const last = resolveMentions('@cyg status?', members);
  assert.equal(last.mentions[0]?.userId, JOHN);

  const two = resolveMentions('@John did he finish?', members);
  assert.equal(two.mentions.length, 0);
  assert.equal(two.ambiguous.length, 1);
  assert.match(
    ambiguitySentence(two.ambiguous[0]!.query, two.ambiguous[0]!.candidates),
    /Which John did you mean\? John Cyganiak or John Smith\./,
  );

  const loginOnly = resolveMentions('@johncyganiak', [
    { userId: JOHN, fullName: null, loginName: 'John Cyganiak' },
  ]);
  assert.equal(loginOnly.mentions[0]?.userId, JOHN);
  assert.equal(loginOnly.mentions[0]?.name, 'John Cyganiak');

  assert.equal(textMentionsPerson('@John the panel is done', JOHN, members), false);
  assert.equal(textMentionsPerson('@John Cyganiak the panel is done', JOHN, members), true);
  assert.equal(textMentionsPerson(`@[John Cyganiak](mention:${JOHN}) hi`, JOHN, members), true);
});

test('org isolation: a claimed id outside the roster never resolves', () => {
  const members = roster();
  const foreign = `@[John Cyganiak](mention:${OUTSIDER}) did he finish the electrical job?`;
  const resolved = resolveMentions(foreign, members);
  assert.equal(resolved.mentions.length, 1);
  assert.equal(resolved.mentions[0]?.userId, JOHN);
  assert.notEqual(resolved.mentions[0]?.userId, OUTSIDER);

  const unknown = resolveMentions(`@[notaperson](mention:${OUTSIDER}) hello`, members);
  assert.deepEqual(unknown.mentions, []);
  assert.deepEqual(unknown.ambiguous, []);

  const leaked = resolveMentions('@johncyganiak status?', members);
  assert.equal(leaked.mentions[0]?.userId, JOHN);
  assert.notEqual(leaked.mentions[0]?.userId, OUTSIDER);
});

test('context ranking prefers the question over a newer unrelated row', () => {
  const olderElectrical = rankMentionItems(
    [
      {
        kind: 'video',
        id: 'old',
        jobId: JOB_ELEC,
        title: 'After — electrical panel',
        text: 'Electrical panel is closed and labeled.',
        at: '2024-01-01T00:00:00.000Z',
      },
      {
        kind: 'video',
        id: 'new',
        jobId: JOB_PLUMB,
        title: 'After — plumbing',
        text: 'Replaced the kitchen faucet.',
        at: '2026-09-01T00:00:00.000Z',
      },
    ],
    'did he finish the electrical job?',
    new Date('2026-09-20T00:00:00.000Z'),
  );
  assert.equal(olderElectrical[0]?.id, 'old');
  assert.ok(olderElectrical.every((item) => item.id !== 'new'));

  const sameTopic = rankMentionItems(
    [
      {
        kind: 'job',
        id: 'old-job',
        jobId: '1',
        title: 'Electrical panel upgrade',
        text: 'electrical',
        at: '2026-01-01T00:00:00.000Z',
      },
      {
        kind: 'job',
        id: 'new-job',
        jobId: '2',
        title: 'Electrical panel upgrade',
        text: 'electrical',
        at: '2026-09-01T00:00:00.000Z',
      },
    ],
    'electrical panel',
    new Date('2026-09-20T00:00:00.000Z'),
  );
  assert.equal(sameTopic[0]?.id, 'new-job');
});

function fakeDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const all = tables[table];
      if (!all) {
        const missing: any = {
          select() {
            return missing;
          },
          eq() {
            return missing;
          },
          in() {
            return missing;
          },
          is() {
            return missing;
          },
          order() {
            return missing;
          },
          limit() {
            return missing;
          },
          upsert() {
            return Promise.resolve({ error: { message: `relation ${table} does not exist` } });
          },
          then(resolve: (value: unknown) => unknown, reject?: (err: unknown) => unknown) {
            return Promise.resolve({ data: null, error: { message: `relation ${table} does not exist` } }).then(
              resolve,
              reject,
            );
          },
        };
        return missing;
      }
      let rows = all.map((row) => ({ ...row }));
      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          rows = rows.filter((row) => row[col] === val);
          return builder;
        },
        in(col: string, vals: unknown[]) {
          const allowed = new Set(vals);
          rows = rows.filter((row) => allowed.has(row[col]));
          return builder;
        },
        is(col: string, val: unknown) {
          rows = rows.filter((row) => (val == null ? row[col] == null : row[col] === val));
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          rows = rows.slice(0, n);
          return builder;
        },
        upsert() {
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (value: unknown) => unknown, reject?: (err: unknown) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function orgTables() {
  return {
    org_members: [
      { org_id: ORG_A, user_id: JOHN, status: 'active', profiles: { email: 'john.cyganiak@example.com', full_name: 'John Cyganiak', handle: 'johncyganiak' } },
      { org_id: ORG_A, user_id: JANE, status: 'active', profiles: { email: 'jane@example.com', full_name: 'Jane Alvarez', handle: null } },
      { org_id: ORG_B, user_id: OUTSIDER, status: 'active', profiles: { email: 'john@other.test', full_name: 'John Cyganiak', handle: 'johncyganiak' } },
    ],
    job_assignments: [
      { org_id: ORG_A, job_id: JOB_ELEC, user_id: JOHN, role_on_job: 'lead', released_at: null, assigned_at: '2026-09-01T00:00:00.000Z' },
      { org_id: ORG_B, job_id: JOB_OTHER_ORG, user_id: OUTSIDER, role_on_job: 'lead', released_at: null, assigned_at: '2026-09-02T00:00:00.000Z' },
    ],
    crm_jobs: [
      { id: JOB_ELEC, org_id: ORG_A, job_number: 1044, title: 'Cedar panel electrical upgrade', status: 'in_progress', work_type: 'electrical', owner_id: JOHN, created_by: JOHN, updated_at: '2026-09-12T00:00:00.000Z' },
      { id: JOB_PLUMB, org_id: ORG_A, job_number: 1045, title: 'Kitchen faucet', status: 'completed', work_type: 'plumbing', owner_id: JANE, created_by: JANE, updated_at: '2026-09-18T00:00:00.000Z' },
      { id: JOB_OTHER_ORG, org_id: ORG_B, job_number: 9, title: 'Other org electrical panel', status: 'accepted', work_type: 'electrical', owner_id: OUTSIDER, created_by: OUTSIDER, updated_at: '2026-09-19T00:00:00.000Z' },
    ],
    job_tasks: [
      { id: 'task-1', org_id: ORG_A, job_id: JOB_ELEC, title: 'Close electrical panel', status: 'done', details: 'Label the breakers', assigned_to: JOHN, updated_at: '2026-09-12T00:00:00.000Z', completed_at: '2026-09-12T00:00:00.000Z' },
    ],
    job_evidence_access: [
      { org_id: ORG_A, proof_id: PROOF_ELEC, job_id: JOB_ELEC, actor_id: JOHN, action: 'uploaded', occurred_at: '2026-09-12T15:00:00.000Z' },
      { org_id: ORG_B, proof_id: PROOF_OTHER, job_id: JOB_OTHER_ORG, actor_id: OUTSIDER, action: 'uploaded', occurred_at: '2026-09-19T15:00:00.000Z' },
    ],
    recording_acknowledgments: [],
    work_logs: [],
    content_mentions: [
      { org_id: ORG_A, mentioned_user_id: JOHN, source: 'job_message', source_id: 'msg-1', job_id: JOB_ELEC, handle: 'johncyganiak', created_at: '2026-09-13T00:00:00.000Z' },
    ],
    job_proofs: [
      {
        id: PROOF_ELEC,
        org_id: ORG_A,
        job_id: JOB_ELEC,
        party_id: 'party-1',
        work_date: '2026-09-12',
        phase: 'after',
        state: 'accepted',
        title: 'Panel after',
        ai_summary: 'Electrical panel is closed and labeled.',
        transcript_text: 'The electrical job is finished.',
        narration_text: null,
        captured_at: '2026-09-12T15:00:00.000Z',
        received_at: '2026-09-12T15:10:00.000Z',
        deleted_at: null,
      },
      {
        id: PROOF_OTHER,
        org_id: ORG_B,
        job_id: JOB_OTHER_ORG,
        party_id: 'party-x',
        work_date: '2026-09-19',
        phase: 'after',
        state: 'accepted',
        title: 'Secret other-org panel',
        ai_summary: 'Electrical panel finished at the other company.',
        transcript_text: 'electrical',
        narration_text: null,
        captured_at: '2026-09-19T15:00:00.000Z',
        received_at: '2026-09-19T15:10:00.000Z',
        deleted_at: null,
      },
    ],
    job_parties: [
      { id: 'party-1', org_id: ORG_A, job_id: JOB_ELEC, created_by: JOHN, company: 'Cyganiak Electric', trade: 'electrical' },
      { id: 'party-x', org_id: ORG_B, job_id: JOB_OTHER_ORG, created_by: OUTSIDER, company: 'Elsewhere', trade: 'electrical' },
    ],
    job_messages: [
      { id: 'msg-1', org_id: ORG_A, job_id: JOB_ELEC, author_id: JANE, author_label: 'Jane Alvarez', body: '@johncyganiak the electrical panel is done, please confirm the label.', created_at: '2026-09-13T00:00:00.000Z' },
      { id: 'msg-b', org_id: ORG_B, job_id: JOB_OTHER_ORG, author_id: OUTSIDER, author_label: 'John', body: '@johncyganiak secret electrical note', created_at: '2026-09-19T00:00:00.000Z' },
    ],
  };
}

test('context retrieval stays inside the org and cites the electrical job', async () => {
  const db = fakeDb(orgTables());
  const people = await loadPersonContext(db as any, {
    orgId: ORG_A,
    people: [{ userId: JOHN, handle: 'johncyganiak', name: 'John Cyganiak' }],
    question: '@johncyganiak did he finish the electrical job?',
    now: new Date('2026-09-20T00:00:00.000Z'),
  });
  assert.equal(people.length, 1);
  const blob = people[0]!.items.map((item) => `${item.title} ${item.text}`).join('\n');
  assert.match(blob, /Cedar panel electrical upgrade/);
  assert.match(blob, /Electrical panel is closed/);
  assert.match(blob, /@johncyganiak the electrical panel is done/);
  assert.doesNotMatch(blob, /other company|Secret other-org|secret electrical/i);

  const answer = answerFromMentionContext('@johncyganiak did he finish the electrical job?', people);
  assert.match(answer.answer, /John/);
  assert.match(answer.answer, /Cedar panel electrical upgrade|Panel after/);
  const recorded = answerFromMentionContext('@johncyganiak did he record the electrical panel?', people);
  assert.doesNotMatch(recorded.answer, /filmed \d+ clips?/);
  assert.match(recorded.answer, /Cedar panel electrical upgrade|Panel after/);
  assert.match(answer.answer, /⟦sources:/);
  assert.match(answer.answer, new RegExp(`job/${JOB_ELEC}/`));
  assert.match(answer.answer, new RegExp(`video/${JOB_ELEC}/${PROOF_ELEC}/`));
  assert.doesNotMatch(answer.answer, /\[\[web:/);
  assert.match(answer.answer, /John Cyganiak/);
  assert.match(answer.answer, /not in the file/);
  assert.doesNotMatch(answer.answer, /filmed \d+ clips?/);
  assert.doesNotMatch(answer.answer, /doesn't have that on file/);
});

test('tagged notes outside the recent message window still load from the mention index', async () => {
  const fillers = Array.from({ length: 120 }, (_, index) => ({
    id: `filler-${index}`,
    org_id: ORG_A,
    job_id: JOB_PLUMB,
    author_id: JANE,
    author_label: 'Jane Alvarez',
    body: 'Unrelated site note.',
    created_at: '2026-09-20T00:00:00.000Z',
  }));
  const base = orgTables();
  const db = fakeDb({
    ...base,
    content_mentions: [
      ...base.content_mentions,
      {
        org_id: ORG_A,
        mentioned_user_id: JOHN,
        source: 'job_message',
        source_id: 'msg-old',
        job_id: JOB_ELEC,
        handle: 'johncyganiak',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    job_messages: [
      ...fillers,
      {
        id: 'msg-old',
        org_id: ORG_A,
        job_id: JOB_ELEC,
        author_id: JANE,
        author_label: 'Jane Alvarez',
        body: 'Confirm the breaker labels on the cedar panel.',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  const people = await loadPersonContext(db as any, {
    orgId: ORG_A,
    people: [{ userId: JOHN, handle: 'johncyganiak', name: 'John Cyganiak' }],
    question: '@johncyganiak where are the breaker labels?',
    now: new Date('2026-09-20T00:00:00.000Z'),
  });
  const notes = people[0]!.items.filter((item) => item.kind === 'note');
  assert.ok(notes.some((item) => item.id === 'msg-old' && /breaker labels/.test(item.text)));
});

test('a person with no matching evidence is told so, and another org is invisible', async () => {
  const db = fakeDb(orgTables());
  const prep = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    question: '@janealvarez did she finish the electrical job?',
    now: new Date('2026-09-20T00:00:00.000Z'),
  });
  assert.equal(prep.mentions[0]?.userId, JANE);
  assert.match(prep.directAnswer ?? '', /Jane Alvarez/);
  assert.match(prep.directAnswer ?? '', /not in the file/);
  assert.match(prep.directAnswer ?? '', /Kitchen faucet/);
  assert.doesNotMatch(prep.directAnswer ?? '', /doesn't have that on file/);
  assert.doesNotMatch(prep.directAnswer ?? '', /filmed \d+ clips?/);
  assert.doesNotMatch(prep.directAnswer ?? '', /No .+ found for/);
  assert.doesNotMatch(prep.directAnswer ?? '', /\[\[web:/);
  assert.doesNotMatch(prep.directAnswer ?? '', /Cedar panel|other-org/);

  const outsider = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    question: `@[johncyganiak](mention:${OUTSIDER}) did he finish the electrical job?`,
    now: new Date('2026-09-20T00:00:00.000Z'),
  });
  assert.equal(outsider.mentions[0]?.userId, JOHN);
  assert.notEqual(outsider.mentions[0]?.userId, OUTSIDER);
  assert.match(outsider.supplement, /Cedar panel electrical upgrade/);
  assert.doesNotMatch(outsider.supplement, /Other org electrical/);
});

test('two Johns asks which person instead of guessing', async () => {
  const base = orgTables();
  const db = fakeDb({
    ...base,
    org_members: [
      ...base.org_members,
      {
        org_id: ORG_A,
        user_id: SMITH,
        status: 'active',
        profiles: { email: 'jsmith@example.com', full_name: 'John Smith', handle: null },
      },
    ],
  });
  const prep = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    question: '@John did he finish the electrical job?',
    now: new Date('2026-09-20T00:00:00.000Z'),
  });
  assert.equal(prep.mentions.length, 0);
  assert.match(prep.directAnswer ?? '', /Which John did you mean\? John Cyganiak or John Smith\./);
  assert.doesNotMatch(prep.directAnswer ?? '', /Cedar panel/);
});

test('job ask stays on that job, and a person from another job is named as absent', async () => {
  const base = orgTables();
  const db = fakeDb({
    ...base,
    job_assignments: [
      ...base.job_assignments,
      {
        org_id: ORG_A,
        job_id: JOB_PLUMB,
        user_id: JOHN,
        role_on_job: 'helper',
        released_at: null,
        assigned_at: '2026-09-02T00:00:00.000Z',
      },
    ],
  });
  const onElectrical = await listJobMentionMembers(db as any, ORG_A, JOB_ELEC);
  assert.ok(onElectrical?.some((member) => member.userId === JOHN));
  assert.equal(onElectrical?.some((member) => member.userId === JANE), false);

  const scoped = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_ELEC,
    question: '@johncyganiak what has he done?',
    now: new Date('2026-09-20T00:00:00.000Z'),
  });
  assert.equal(scoped.mentions[0]?.userId, JOHN);
  assert.match(scoped.directAnswer ?? '', /Cedar panel/);
  assert.doesNotMatch(scoped.directAnswer ?? '', /Kitchen faucet/);

  const orgWide = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    question: '@johncyganiak what has he done?',
    now: new Date('2026-09-20T00:00:00.000Z'),
  });
  assert.match(orgWide.directAnswer ?? '', /Cedar panel/);
  assert.match(orgWide.directAnswer ?? '', /Kitchen faucet/);

  const absent = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_ELEC,
    question: '@janealvarez did she finish the electrical job?',
    now: new Date('2026-09-20T00:00:00.000Z'),
  });
  assert.equal(absent.mentions.length, 0);
  assert.match(absent.directAnswer ?? '', /Jane Alvarez isn't on this job/);
  assert.match(absent.directAnswer ?? '', /Kitchen faucet/);
  assert.doesNotMatch(absent.directAnswer ?? '', /Cedar panel electrical/);

  const foreign = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_OTHER_ORG,
    question: '@johncyganiak status?',
    now: new Date('2026-09-20T00:00:00.000Z'),
  });
  assert.match(foreign.directAnswer ?? '', /isn't in this organization/);
  assert.doesNotMatch(foreign.directAnswer ?? '', /Other org|Secret/);
});

test('job-scoped context keeps this job when other jobs fill the fetch windows', async () => {
  const proofFillers = Array.from({ length: 60 }, (_, index) => ({
    id: `proof-other-${index}`,
    org_id: ORG_A,
    job_id: JOB_PLUMB,
    party_id: 'party-plumb',
    work_date: '2026-09-20',
    phase: 'after',
    state: 'accepted',
    title: `Faucet clip ${index}`,
    ai_summary: 'Replaced the kitchen faucet.',
    transcript_text: null,
    narration_text: null,
    captured_at: '2026-09-20T15:00:00.000Z',
    received_at: '2026-09-20T15:10:00.000Z',
    deleted_at: null,
  }));
  const logFillers = Array.from({ length: 40 }, (_, index) => ({
    id: `log-other-${index}`,
    org_id: ORG_A,
    job_id: JOB_PLUMB,
    author_id: JOHN,
    body: 'Logged the kitchen faucet replacement.',
    kind: 'note',
    occurred_at: '2026-09-20T12:00:00.000Z',
  }));
  const messageFillers = Array.from({ length: 120 }, (_, index) => ({
    id: `msg-other-${index}`,
    org_id: ORG_A,
    job_id: JOB_PLUMB,
    author_id: JANE,
    author_label: 'Jane Alvarez',
    body: '@johncyganiak kitchen faucet note.',
    created_at: '2026-09-20T00:00:00.000Z',
  }));
  const base = orgTables();
  const db = fakeDb({
    ...base,
    job_assignments: [
      ...base.job_assignments,
      {
        org_id: ORG_A,
        job_id: JOB_PLUMB,
        user_id: JOHN,
        role_on_job: 'helper',
        released_at: null,
        assigned_at: '2026-09-02T00:00:00.000Z',
      },
    ],
    job_proofs: [...proofFillers, ...base.job_proofs],
    work_logs: [
      ...logFillers,
      {
        id: 'log-elec',
        org_id: ORG_A,
        job_id: JOB_ELEC,
        author_id: JOHN,
        body: 'Closed the electrical panel.',
        kind: 'note',
        occurred_at: '2026-09-12T12:00:00.000Z',
      },
    ],
    content_mentions: Array.from({ length: 80 }, (_, index) => ({
      org_id: ORG_A,
      mentioned_user_id: JOHN,
      source: 'job_message',
      source_id: `msg-other-${index}`,
      job_id: JOB_PLUMB,
      handle: 'johncyganiak',
      created_at: '2026-09-20T00:00:00.000Z',
    })),
    job_messages: [
      ...messageFillers,
      {
        id: 'msg-elec',
        org_id: ORG_A,
        job_id: JOB_ELEC,
        author_id: JANE,
        author_label: 'Jane Alvarez',
        body: '@johncyganiak the electrical panel is done.',
        created_at: '2026-09-12T00:00:00.000Z',
      },
    ],
  });
  const people = await loadPersonContext(db as any, {
    orgId: ORG_A,
    people: [{ userId: JOHN, handle: 'johncyganiak', name: 'John Cyganiak' }],
    question: '@johncyganiak electrical panel',
    now: new Date('2026-09-21T00:00:00.000Z'),
    jobId: JOB_ELEC,
  });
  const items = people[0]!.items;
  assert.ok(items.some((item) => item.id === PROOF_ELEC));
  assert.ok(items.some((item) => item.id === 'log-elec'));
  assert.ok(items.some((item) => item.id === 'msg-elec'));
  assert.equal(items.some((item) => item.jobId === JOB_PLUMB), false);
});

const here = dirname(fileURLToPath(import.meta.url));

test('share-link clip Ask does not resolve org mentions', () => {
  const portal = readFileSync(join(here, '../src/routes/evidencePortal.ts'), 'utf8');
  assert.match(portal, /opts\.orgMentions && opts\.askedBy/);
  const shareAt = portal.indexOf('POST /api/verifier-share/:token/evidence/:proofId/ask');
  assert.ok(shareAt > 0);
  const share = portal.slice(shareAt, shareAt + 2200);
  assert.match(share, /orgMentions:\s*false/);
  assert.doesNotMatch(share, /orgMentions:\s*true/);
  const orgAt = portal.indexOf("evidencePortalRouter.post(\n  '/evidence/:proofId/ask'");
  assert.ok(orgAt > 0 && orgAt < shareAt);
  assert.match(portal.slice(orgAt, shareAt), /orgMentions:\s*true/);

  const verifier = readFileSync(join(here, '../../verifier/index.html'), 'utf8');
  assert.match(verifier, /if \(rosterLoaded \|\| !ORG_MODE\) return/);
  assert.match(verifier, /if \(form && ORG_MODE\) form\.appendChild\(menu\)/);
  assert.match(verifier, /if \(SHARE_TOKEN\) \{/);
});

const EL = '55555555-5555-4555-8555-555555555555';
const EL_SEAT = '66666666-6666-4666-8666-666666666666';
const JOB_TIFFANY = '77777777-7777-4777-8777-777777777777';
const CLIP_OFFICE = '88888888-8888-4888-8888-888888888881';
const CLIP_TABLE = '88888888-8888-4888-8888-888888888882';
const CLIP_WALK = '88888888-8888-4888-8888-888888888883';
const CLIP_OTHER = '88888888-8888-4888-8888-888888888884';

function tiffanyTables() {
  return {
    org_members: [
      {
        org_id: ORG_A,
        user_id: EL,
        status: 'active',
        profiles: { email: 'el@example.com', full_name: 'El Presidente', handle: null, avatar_url: null },
      },
    ],
    profiles: [{ id: EL_SEAT, email: fieldCaptureEmail(ORG_A, 'El Presidente') }],
    job_assignments: [],
    crm_jobs: [
      {
        id: JOB_TIFFANY,
        org_id: ORG_A,
        job_number: 12,
        title: 'Project Tiffany & Co.',
        status: 'scheduled',
        work_type: 'restoration',
        owner_id: null,
        created_by: EL,
        created_at: '2026-09-17T16:37:28.774Z',
        updated_at: '2026-09-21T00:00:00.000Z',
      },
    ],
    job_tasks: [],
    job_evidence_access: [
      { org_id: ORG_A, proof_id: CLIP_OFFICE, job_id: JOB_TIFFANY, actor_id: null, action: 'uploaded', occurred_at: '2026-09-17T16:00:00.000Z' },
      { org_id: ORG_A, proof_id: CLIP_TABLE, job_id: JOB_TIFFANY, actor_id: null, action: 'uploaded', occurred_at: '2026-09-21T22:00:00.000Z' },
      { org_id: ORG_A, proof_id: CLIP_WALK, job_id: JOB_TIFFANY, actor_id: null, action: 'uploaded', occurred_at: '2026-09-21T23:00:00.000Z' },
    ],
    recording_acknowledgments: [],
    work_logs: [],
    content_mentions: [],
    job_proofs: [
      {
        id: CLIP_OFFICE,
        org_id: ORG_A,
        job_id: JOB_TIFFANY,
        party_id: 'party-el',
        work_date: '2026-09-17',
        phase: 'after',
        state: 'analysed',
        title: 'Sep 17 office recording',
        ai_summary: 'A single fixed webcam-style take of one seated man in a small office.',
        transcript_text: '[0:04] It\'s simple.',
        narration_text: null,
        ai_findings: {
          events: [{ text: 'Light-blue binder labeled RESTORE 365.' }],
          people: { speakers: [{ speakerLabel: 'Person 1', displayName: 'Seated man', turnCount: 1 }] },
        },
        device_metadata: {},
        captured_at: '2026-09-17T16:00:00.000Z',
        received_at: '2026-09-17T16:05:00.000Z',
        deleted_at: null,
      },
      {
        id: CLIP_TABLE,
        org_id: ORG_A,
        job_id: JOB_TIFFANY,
        party_id: 'party-el',
        work_date: '2026-09-21',
        phase: 'after',
        state: 'analysed',
        title: 'Sep 21 tabletop close-up',
        ai_summary: 'Blurry close passes over a whitewashed wood tabletop and trellis wallpaper.',
        transcript_text: 'But I know they have their ways.',
        narration_text: null,
        ai_findings: null,
        device_metadata: { userId: EL },
        captured_at: '2026-09-21T22:00:00.000Z',
        received_at: '2026-09-21T22:05:00.000Z',
        deleted_at: null,
      },
      {
        id: CLIP_WALK,
        org_id: ORG_A,
        job_id: JOB_TIFFANY,
        party_id: 'party-seat',
        work_date: '2026-09-21',
        phase: 'after',
        state: 'analysed',
        title: 'Sep 21 home walkthrough,',
        ai_summary: 'Handheld interior walkthrough of a furnished home, chandelier and dining wall.',
        transcript_text: 'Her entire life.',
        narration_text: null,
        ai_findings: null,
        device_metadata: {},
        captured_at: '2026-09-21T23:00:00.000Z',
        received_at: '2026-09-21T23:05:00.000Z',
        deleted_at: null,
      },
      {
        id: CLIP_OTHER,
        org_id: ORG_A,
        job_id: JOB_TIFFANY,
        party_id: 'party-other',
        work_date: '2026-09-22',
        phase: 'after',
        state: 'analysed',
        title: 'Someone else roof clip',
        ai_summary: 'A different crew member filmed the roof.',
        transcript_text: null,
        narration_text: null,
        ai_findings: null,
        device_metadata: {},
        captured_at: '2026-09-22T12:00:00.000Z',
        received_at: '2026-09-22T12:05:00.000Z',
        deleted_at: null,
      },
    ],
    job_parties: [
      {
        id: 'party-el',
        org_id: ORG_A,
        job_id: JOB_TIFFANY,
        created_by: EL,
        company: 'Field Capture',
        trade: 'field_capture',
        created_at: '2026-09-17T16:37:29.206Z',
      },
      {
        id: 'party-seat',
        org_id: ORG_A,
        job_id: JOB_TIFFANY,
        created_by: EL_SEAT,
        company: 'Field Capture',
        trade: 'field_capture',
        created_at: '2026-09-17T16:37:29.206Z',
      },
      { id: 'party-other', org_id: ORG_A, job_id: JOB_TIFFANY, created_by: JANE, company: 'Other crew', trade: 'roofing' },
    ],
    job_messages: [],
    memory_events: [
      {
        id: 'mem-tiffany',
        org_id: ORG_A,
        job_id: JOB_TIFFANY,
        actor_id: EL,
        event_type: 'job.created',
        summary: 'opened job #12 — Project Tiffany & Co.',
        occurred_at: '2026-09-17T16:37:28.774Z',
      },
    ],
    orgs: [{ id: ORG_A, daily_job_report_timezone: 'America/Chicago' }],
  };
}

test('multi-word names stay whole, and the fallback lists every clip that person filmed', async () => {
  const roster = [{ userId: EL, fullName: 'El Presidente', email: 'el@example.com' }];
  const chip = `@[El Presidente](mention:${EL})`;
  assert.equal(stripMentionMarks(`${chip} which clips did he film`, ['El Presidente']).includes('El Presidente'), false);
  assert.match(stripMentionMarks('which clips did @El Presidente film', ['El Presidente']), /which clips did\s+film/);
  const resolved = resolveMentions('which clips did @El Presidente film', roster);
  assert.equal(resolved.mentions[0]?.name, 'El Presidente');
  const punctuated = resolveMentions("what did @Mary-Jane O'Brien film", [
    { userId: EL, fullName: "Mary-Jane O'Brien" },
  ]);
  assert.equal(punctuated.mentions[0]?.name, "Mary-Jane O'Brien");
  const jane = resolveMentions("summarize @Jane's work", [{ userId: JANE, fullName: 'Jane Alvarez' }]);
  assert.equal(jane.mentions[0]?.userId, JANE);
  assert.equal(jane.mentions[0]?.name, 'Jane Alvarez');
  const janeEnd = resolveMentions("summarize @Jane's", [{ userId: JANE, fullName: 'Jane Alvarez' }]);
  assert.equal(janeEnd.mentions[0]?.userId, JANE);
  const janeCurly = resolveMentions('summarize @Jane’s work', [{ userId: JANE, fullName: 'Jane Alvarez' }]);
  assert.equal(janeCurly.mentions[0]?.userId, JANE);
  const possessive = resolveMentions("what did @El Presidente's crew film", roster);
  assert.equal(possessive.mentions[0]?.userId, EL);
  const wrapped = resolveMentions("summarize (@El Presidente's) work", [
    { userId: EL, fullName: 'El Presidente' },
    { userId: JANE, fullName: 'El Other' },
  ]);
  assert.equal(wrapped.ambiguous.length, 0);
  assert.equal(wrapped.mentions[0]?.userId, EL);
  assert.equal(wrapped.mentions.length, 1);

  const db = fakeDb(tiffanyTables());
  const which = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_TIFFANY,
    question: `${chip} which clips did he film`,
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
  const whichAnswer = which.directAnswer ?? '';
  assert.match(whichAnswer, /Sep 17 office recording/);
  assert.match(whichAnswer, /Sep 21 tabletop close-up/);
  assert.match(whichAnswer, /Sep 21 home walkthrough/);
  assert.match(whichAnswer, /RESTORE 365/);
  assert.match(whichAnswer, /webcam-style take/);
  assert.match(whichAnswer, /not in the file/);
  assert.doesNotMatch(whichAnswer, /filmed \d+ clips?/);
  assert.doesNotMatch(whichAnswer, /doesn't have that on file/);
  assert.doesNotMatch(whichAnswer, /It's simple/);
  assert.doesNotMatch(whichAnswer, /Her entire life/);
  assert.doesNotMatch(whichAnswer, /But I know they have their ways/);
  assert.doesNotMatch(whichAnswer, /Someone else roof/);

  const follow = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_TIFFANY,
    question: 'what all the videos they upload',
    history: [{ role: 'user', text: 'what did @El Presidente take a video of' }, { role: 'assistant', text: whichAnswer }],
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
  assert.equal(follow.mentions[0]?.userId, EL);
  assert.match(follow.directAnswer ?? '', /office recording/);
  assert.match(follow.directAnswer ?? '', /tabletop/);
  assert.match(follow.directAnswer ?? '', /walkthrough/);
  assert.equal(carryPriorMention('what about the weather', [], roster), null);
});

test('a missing model gets a grounded briefing, not a keyword template', async () => {
  const db = fakeDb(tiffanyTables());
  const prep = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_TIFFANY,
    question: 'what did @El Presidente say about the leak?',
    askerUserId: EL,
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
  const answer = prep.directAnswer ?? '';
  assert.match(answer, /On Project Tiffany & Co, this is what the file attributes to you/);
  assert.match(answer, /not in the file/);
  assert.match(answer, /Sep 17, 11:00 AM CT — Sep 17 office recording/);
  assert.match(answer, /Sep 21, 5:00 PM CT — Sep 21 tabletop close-up/);
  assert.match(answer, /Sep 21, 6:00 PM CT — Sep 21 home walkthrough/);
  assert.match(answer, /Sep 17: You opened this job file and created the Field Capture party/);
  assert.match(answer, /RESTORE 365/);
  assert.match(answer, /⟦sources:/);
  assert.match(answer, new RegExp(`video/${JOB_TIFFANY}/${CLIP_OFFICE}/`));
  assert.doesNotMatch(answer, /filmed \d+ clips?/);
  assert.doesNotMatch(answer, /doesn't have that on file/);
  assert.doesNotMatch(answer, /you recorded 3 videos/);
  assert.doesNotMatch(answer, /#12/);
  assert.doesNotMatch(answer, /UTC/);
  assert.doesNotMatch(answer, /It's simple/);
  assert.doesNotMatch(answer, /\[\[web:/);
  assert.equal(prep.fallbackAnswer, prep.directAnswer);
});

test('a configured model gets the dossier, the job file, and the recent turns', async () => {
  const db = fakeDb(tiffanyTables());
  const history = [
    { role: 'user' as const, text: 'what had @El Presidente done in this file' },
    { role: 'assistant' as const, text: 'You recorded the office clip on Sep 17.' },
  ];
  const question = 'what did he say in the office clip';
  const prep = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_TIFFANY,
    question,
    askerUserId: EL,
    history,
    anthropicApiKey: 'test-key-not-a-real-secret',
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
  assert.equal(prep.directAnswer, null);
  assert.equal(prep.mentions[0]?.userId, EL);
  assert.match(prep.supplement, /MENTION ASK/);
  assert.match(prep.supplement, /ATTRIBUTION DOSSIER for El Presidente/);
  assert.match(prep.supplement, /Address them as "you"/);
  assert.match(prep.supplement, /Recorded by this person/);
  assert.match(prep.supplement, /Sep 17 office recording/);
  assert.match(prep.supplement, /priority-clip:/);
  const recorded = prep.supplement.split('Someone else recorded:')[0] ?? '';
  assert.match(recorded, /Sep 17 office recording/);
  assert.doesNotMatch(recorded, /Someone else roof/);
  assert.match(prep.supplement, /JOB FILE/);
  assert.match(prep.supplement, /webcam-style take/);
  assert.match(prep.supplement, /RESTORE 365/);
  assert.match(prep.supplement, /Speakers: Seated man/);
  assert.match(prep.supplement, /\[0:04\] It's simple/);
  assert.match(prep.supplement, /Field Capture/);
  assert.match(prep.supplement, /opened job #12/);
  assert.match(prep.supplement, /Shares:\nnone/);
  assert.match(prep.supplement, /RECENT CONVERSATION/);
  assert.match(prep.supplement, /what had @El Presidente done in this file/);
  assert.match(prep.supplement, /not in the file/);
  assert.match(prep.supplement, /⟦sources:/);
  assert.doesNotMatch(prep.supplement, /one-line overview/);
  assert.doesNotMatch(prep.supplement, /filmed \d+ clips/);
  assert.match(activitySystemAddendum(prep.supplement) ?? '', /not in the file/);
  assert.match(activitySystemAddendum(prep.supplement) ?? '', /⟦sources:/);
  assert.doesNotMatch(activitySystemAddendum(prep.supplement) ?? '', /one-line overview/);
  assert.match(MENTION_MODEL_INSTRUCTIONS, /Never invent/);
  assert.match(prep.fallbackAnswer ?? '', /this is what the file attributes to you/);
  assert.doesNotMatch(prep.fallbackAnswer ?? '', /It's simple/);

  const prompt = assembleMentionModelPrompt({
    question,
    history,
    file: {
      job: { title: 'Project Tiffany & Co.', jobNumber: 12, status: 'scheduled' },
      mentionSupplement: prep.supplement,
      clips: [
        {
          proofId: CLIP_OTHER,
          workDate: '2026-09-22',
          summary: 'A different crew member filmed the roof.',
          transcript: 'Roof crew only.',
        },
        {
          proofId: CLIP_OFFICE,
          workDate: '2026-09-17',
          summary: 'A single fixed webcam-style take of one seated man in a small office.',
          transcript: "[0:04] It's simple.",
        },
      ],
    },
  });
  assert.match(prompt.system, /MENTION ASK|not in the file/);
  assert.match(prompt.system, /⟦sources:/);
  assert.match(prompt.user, /ATTRIBUTION DOSSIER/);
  assert.match(prompt.user, /JOB FILE/);
  assert.match(prompt.user, /RECENT CONVERSATION/);
  assert.match(prompt.user, /Earlier questions on this file/);
  assert.match(prompt.user, /Question: what did he say in the office clip/);
  const videosAt = prompt.user.indexOf('Videos and mic');
  const mentionAt = prompt.user.indexOf('MENTION ASK');
  assert.ok(videosAt > 0 && mentionAt > videosAt);
  const videos = prompt.user.slice(videosAt, mentionAt);
  assert.ok(videos.indexOf('webcam-style') >= 0);
  assert.ok(videos.indexOf('webcam-style') < videos.indexOf('different crew'));

  const here = dirname(fileURLToPath(import.meta.url));
  const jobAsk = readFileSync(join(here, '../src/shared/jobFileAsk.ts'), 'utf8');
  const clipAsk = readFileSync(join(here, '../src/shared/clipAsk.ts'), 'utf8');
  assert.match(jobAsk, /assembleMentionModelPrompt/);
  assert.match(jobAsk, /activitySystemAddendum/);
  assert.match(clipAsk, /activitySystemAddendum/);
});

test('six mention questions all go to the model instead of a template', async () => {
  const db = fakeDb(tiffanyTables());
  const prior = [{ role: 'user', text: 'what had @El Presidente done in this file' }, { role: 'assistant', text: 'The office clip is on Sep 17.' }];
  const questions = [
    'what had @El Presidente done in this file',
    'what did @El Presidente say about the leak?',
    'did @El Presidente check the attic?',
    'when was the last time @El Presidente was on site?',
    'how does the office clip compare with the walkthrough for @El Presidente?',
    'what did he say in the office clip',
  ];
  for (const question of questions) {
    const prep = await prepareMentionAsk(db as any, {
      orgId: ORG_A,
      jobId: JOB_TIFFANY,
      question,
      askerUserId: EL,
      history: question.startsWith('what did he') ? prior : [],
      anthropicApiKey: 'test-key-not-a-real-secret',
      now: new Date('2026-09-22T00:00:00.000Z'),
    });
    assert.equal(prep.directAnswer, null, question);
    assert.equal(prep.mentions[0]?.userId, EL, question);
    assert.match(prep.supplement, /ATTRIBUTION DOSSIER/);
    assert.match(prep.supplement, /JOB FILE/);
    assert.match(prep.supplement, /Sep 17 office recording/);
    assert.match(prep.supplement, /\[0:04\] It's simple/);
    assert.match(prep.fallbackAnswer ?? '', /not in the file/);
    assert.doesNotMatch(prep.fallbackAnswer ?? '', /filmed \d+ clips?|doesn't have that on file/);
  }
});

test('filmed clips stay in the briefing when other file notes outrank them', async () => {
  const notes = Array.from({ length: 45 }, (_, index) => ({
    id: `file-note-${index}`,
    org_id: ORG_A,
    job_id: JOB_TIFFANY,
    author_id: EL,
    author_label: 'El Presidente',
    body: 'Updated the file notes for this file.',
    created_at: `2026-09-20T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  }));
  const db = fakeDb({ ...tiffanyTables(), job_messages: notes });
  const prep = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_TIFFANY,
    question: 'what had @El Presidente done in this file',
    askerUserId: EL,
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
  const answer = prep.directAnswer ?? '';
  assert.match(answer, /Sep 17 office recording/);
  assert.match(answer, /Sep 21 tabletop close-up/);
  assert.match(answer, /Sep 21 home walkthrough/);
  assert.doesNotMatch(answer, /filmed \d+ clips?/);
});

test('a clip someone was only tagged in is not counted as recorded', async () => {
  const tables = tiffanyTables();
  tables.job_proofs.push({
    id: '99999999-9999-4999-8999-999999999999',
    org_id: ORG_A,
    job_id: JOB_TIFFANY,
    party_id: 'party-other',
    work_date: '2026-09-22',
    phase: 'after',
    state: 'analysed',
    title: 'Tagged only roof mention',
    ai_summary: 'Another crew filmed the roof.',
    transcript_text: `@[El Presidente](mention:${EL}) stood nearby.`,
    narration_text: null,
    ai_findings: null,
    device_metadata: {},
    captured_at: '2026-09-22T18:00:00.000Z',
    received_at: '2026-09-22T18:05:00.000Z',
    deleted_at: null,
  });
  const db = fakeDb(tables);
  const prep = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_TIFFANY,
    question: 'what had @El Presidente done in this file',
    askerUserId: EL,
    anthropicApiKey: 'test-key-not-a-real-secret',
    now: new Date('2026-09-23T00:00:00.000Z'),
  });
  const answer = prep.fallbackAnswer ?? '';
  assert.match(answer, /Sep 17 office recording/);
  assert.match(answer, /Named in Tagged only roof mention, which someone else recorded/);
  assert.doesNotMatch(answer, /recorded 4/);
  const recorded = prep.supplement.split('Someone else recorded:')[0] ?? '';
  assert.doesNotMatch(recorded, /Tagged only roof mention/);
  assert.match(prep.supplement, /Tagged only roof mention/);
  assert.match(prep.supplement, /stood nearby/);
});

test('party and job events keep a date without a memory row', async () => {
  const tables = tiffanyTables();
  tables.memory_events = [];
  const db = fakeDb(tables);
  const prep = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_TIFFANY,
    question: 'what had @El Presidente done in this file',
    askerUserId: EL,
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
  assert.match(prep.directAnswer ?? '', /Sep 17: You opened this job file and created the Field Capture party/);
  assert.match(prep.supplement, /Job history:\nnone/);
  assert.match(prep.supplement, /Sep 17, 11:37 AM CT — Field Capture/);
  assert.doesNotMatch(prep.directAnswer ?? '', /Undated/);
});

test('redacted and child-privacy speech never reach the mention prompt or fallback', async () => {
  const secret = 'zephyrprivacyphrase9f3a';
  const child = 'zephyrchildphrase9f3a';
  const safeLine = 'attic panel looks fine today';
  const tables = tiffanyTables();
  tables.job_proofs.push({
    id: '88888888-8888-4888-8888-888888888885',
    org_id: ORG_A,
    job_id: JOB_TIFFANY,
    party_id: 'party-el',
    work_date: '2026-09-18',
    phase: 'after',
    state: 'analysed',
    title: 'Privacy leak clip',
    ai_summary: `The speaker said ${secret} during the take and later ${child} was audible.`,
    transcript_text: `[0:04] ${safeLine}\n[0:10] ${secret} was spoken here\n[0:20] ${child} was spoken here`,
    narration_text: `Narration repeats ${secret} and then ${child}.`,
    transcript_segments: [
      { start: 4, text: safeLine },
      { start: 10, text: `${secret} was spoken here` },
      { start: 20, text: `${child} was spoken here` },
    ],
    transcript_words: [
      { start: 4, word: 'attic' },
      { start: 10, word: secret },
      { start: 20, word: child },
    ],
    ai_findings: {
      privacyRedactions: {
        ranges: [{ startSec: 8, endSec: 15, reason: 'bathroom', confidence: 0.9, source: 'manual' }],
      },
      childPrivacyRedactions: {
        ranges: [{ startSec: 18, endSec: 26, reason: 'child present', confidence: 0.9, source: 'manual' }],
      },
      events: [
        { atSeconds: 10, type: 'said', text: `${secret} was spoken here`, quote: `${secret} was spoken here` },
        { atSeconds: 4, type: 'said', text: safeLine },
      ],
      highlights: [
        { tSec: 10, text: `${secret} was spoken here` },
        { tSec: 20, text: `${child} was spoken here` },
      ],
      people: { speakers: [{ displayName: 'Seated man', quote: `${secret} was spoken here`, tSec: 10 }] },
    },
    device_metadata: {},
    captured_at: '2026-09-18T15:00:00.000Z',
    received_at: '2026-09-18T15:05:00.000Z',
    deleted_at: null,
  });
  const db = fakeDb(tables);
  const question = 'what had @El Presidente done in this file';
  const offline = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_TIFFANY,
    question,
    askerUserId: EL,
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
  const online = await prepareMentionAsk(db as any, {
    orgId: ORG_A,
    jobId: JOB_TIFFANY,
    question,
    askerUserId: EL,
    anthropicApiKey: 'test-key-not-a-real-secret',
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
  const clips = collectionClipsFromRows(tables.job_proofs);
  const prompt = assembleMentionModelPrompt({
    question,
    file: { mentionSupplement: online.supplement, clips },
  });
  const blobs = [
    offline.directAnswer ?? '',
    offline.fallbackAnswer ?? '',
    online.supplement,
    online.fallbackAnswer ?? '',
    prompt.system,
    prompt.user,
  ];
  for (const blob of blobs) {
    assert.equal(blob.includes(secret), false);
    assert.equal(blob.includes(child), false);
  }
  assert.match(online.supplement, /attic panel looks fine today/);
  assert.match(online.supplement, new RegExp(PRIVACY_REDACTED_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(online.supplement, new RegExp(CHILD_PRIVACY_REDACTED_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(online.supplement, /Timed segments:/);
  assert.match(online.supplement, /Word list:/);
  assert.match(prompt.user, /attic panel looks fine today/);
  assert.doesNotMatch(offline.directAnswer ?? '', new RegExp(secret));
  assert.doesNotMatch(offline.fallbackAnswer ?? '', new RegExp(child));
});
