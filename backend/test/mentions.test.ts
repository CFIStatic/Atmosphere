import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ambiguitySentence,
  answerFromMentionContext,
  loginNameFromMetadata,
  mentionDisplayName,
  mentionToken,
  noEvidenceSentence,
  parseMentions,
  rankMentionItems,
  resolveMentions,
  textMentionsPerson,
  type MentionMember,
} from '../src/shared/mentions.js';
import { loadPersonContext, prepareMentionAsk } from '../src/shared/mentionContext.js';

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
  assert.match(answer.answer, /⟦sources:/);
  assert.match(answer.answer, new RegExp(`job/${JOB_ELEC}/`));
  assert.match(answer.answer, new RegExp(`video/${JOB_ELEC}/${PROOF_ELEC}/`));
  assert.doesNotMatch(answer.answer, /\[\[web:/);
  assert.equal(noEvidenceSentence({ name: 'John Cyganiak', handle: 'johncyganiak' }, 'did he finish the electrical job?'), 'No electrical job found for John.');
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
  assert.match(prep.directAnswer ?? '', /No electrical job found for Jane/);
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
