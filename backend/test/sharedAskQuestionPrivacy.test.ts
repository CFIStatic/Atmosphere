import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  excludeOfficeOnlyRows,
  listSharedProofQuestions,
  questionListingKeepsOfficeOnly,
} from '../src/shared/askQuestionVisibility.js';
import { sessionAnswerIsPrivate, type AskDocumentView } from '../src/documents/answer.js';

const here = dirname(fileURLToPath(import.meta.url));
const proofOfWork = readFileSync(join(here, '../src/routes/proofOfWork.ts'), 'utf8');
const progressShare = readFileSync(join(here, '../src/routes/progressShare.ts'), 'utf8');

type StoredQuestion = {
  id: string;
  org_id: string;
  job_id: string;
  thread_id: string | null;
  question: string;
  answer: string;
  office_only: boolean;
  document_ids?: string[];
};

const ORG = 'org-1';
const JOB = 'job-1';
const OFFICE_THREAD = 'thread-office';
const PRIVATE_ANSWER = 'Jack Cyganiak wrote the vision note about Jettx.';
const UPLOAD_ID = '00000000-0000-4000-8000-00000000d303';

const ROWS: StoredQuestion[] = [
  {
    id: 'public',
    org_id: ORG,
    job_id: JOB,
    thread_id: 'thread-public',
    question: 'What is the lockbox code?',
    answer: 'The lockbox code is 4821.',
    office_only: false,
    document_ids: [UPLOAD_ID],
  },
  {
    id: 'private',
    org_id: ORG,
    job_id: JOB,
    thread_id: OFFICE_THREAD,
    question: 'Who wrote it?',
    answer: PRIVATE_ANSWER,
    office_only: true,
    document_ids: [UPLOAD_ID],
  },
];

function listingClient(rows: StoredQuestion[]) {
  return {
    from(table: string) {
      assert.equal(table, 'job_proof_questions');
      const filters: Array<[string, unknown]> = [];
      const api = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return api;
        },
        order() {
          return api;
        },
        limit(count: number) {
          const data = rows
            .filter((row) =>
              filters.every(([column, value]) => {
                if (column === 'org_id') return row.org_id === value;
                if (column === 'job_id') return row.job_id === value;
                if (column === 'thread_id') return row.thread_id === value;
                if (column === 'office_only') return row.office_only === value;
                return false;
              }),
            )
            .slice(0, count);
          return Promise.resolve({ data });
        },
      };
      return api;
    },
  };
}

function answers(rows: unknown[]): string[] {
  return rows.map((row) => String((row as { answer?: string }).answer ?? ''));
}

test('grant and unthreaded proof question listings omit unrelated upload answers', async () => {
  const questionsFn = proofOfWork.slice(
    proofOfWork.indexOf('export async function proofQuestions'),
    proofOfWork.indexOf('export async function listJobAskThreads'),
  );
  assert.match(questionsFn, /listSharedProofQuestions\(/);
  assert.match(questionsFn, /access:\s*access === 'org' \? 'org' : 'viewer'/);
  assert.match(questionsFn, /resolveOrgOrViewerAccess/);
  assert.match(questionsFn, /getAskThreadForOwner/);
  assert.match(questionsFn, /omitSessionDocumentIds/);

  const client = listingClient(ROWS);
  const viewer = await listSharedProofQuestions(client, {
    orgId: ORG,
    jobId: JOB,
    threadId: null,
    access: 'viewer',
  });
  assert.deepEqual(answers(viewer), ['The lockbox code is 4821.']);
  assert.equal(answers(viewer).some((answer) => answer.includes('Jack Cyganiak')), false);

  const viewerThread = await listSharedProofQuestions(client, {
    orgId: ORG,
    jobId: JOB,
    threadId: OFFICE_THREAD,
    access: 'viewer',
  });
  assert.deepEqual(answers(viewerThread), []);

  const jobWide = await listSharedProofQuestions(client, {
    orgId: ORG,
    jobId: JOB,
    threadId: null,
    access: 'org',
  });
  assert.deepEqual(answers(jobWide), ['The lockbox code is 4821.']);

  const officeThread = await listSharedProofQuestions(client, {
    orgId: ORG,
    jobId: JOB,
    threadId: OFFICE_THREAD,
    access: 'org',
  });
  assert.deepEqual(answers(officeThread), [PRIVATE_ANSWER]);
  assert.deepEqual((officeThread[0] as { document_ids?: string[] }).document_ids, [UPLOAD_ID]);
  assert.equal('document_ids' in (viewer[0] as object), false);
});

test('share-link ask question listings omit unrelated upload answers', async () => {
  const shareFn = progressShare.slice(
    progressShare.indexOf("'/:token/ask/questions'"),
    progressShare.indexOf("'/:token/ask'"),
  );
  assert.match(shareFn, /listSharedProofQuestions\(/);
  assert.match(shareFn, /access:\s*'share'/);
  assert.doesNotMatch(shareFn, /questionListingKeepsOfficeOnly/);

  const client = listingClient(ROWS);
  const open = await listSharedProofQuestions(client, {
    orgId: ORG,
    jobId: JOB,
    threadId: null,
    access: 'share',
  });
  assert.deepEqual(answers(open), ['The lockbox code is 4821.']);
  assert.equal(answers(open).join('\n').includes('Jettx'), false);
  assert.equal('document_ids' in (open[0] as object), false);

  const threaded = await listSharedProofQuestions(client, {
    orgId: ORG,
    jobId: JOB,
    threadId: OFFICE_THREAD,
    access: 'share',
  });
  assert.deepEqual(answers(threaded), []);
});

test('viewer and job-wide history queries drop office-only rows', () => {
  assert.equal(questionListingKeepsOfficeOnly('org', OFFICE_THREAD), true);
  assert.equal(questionListingKeepsOfficeOnly('org', null), false);
  assert.equal(questionListingKeepsOfficeOnly('viewer', OFFICE_THREAD), false);
  assert.equal(questionListingKeepsOfficeOnly('share', OFFICE_THREAD), false);

  const calls: Array<[string, unknown]> = [];
  const query = {
    eq(column: string, value: unknown) {
      calls.push([column, value]);
      return query;
    },
  };
  assert.equal(excludeOfficeOnlyRows(query, 'org', OFFICE_THREAD), query);
  assert.deepEqual(calls, []);
  excludeOfficeOnlyRows(query, 'viewer', OFFICE_THREAD);
  excludeOfficeOnlyRows(query, 'share', null);
  excludeOfficeOnlyRows(query, 'org', null);
  assert.deepEqual(calls, [
    ['office_only', false],
    ['office_only', false],
    ['office_only', false],
  ]);

  const ask = proofOfWork.slice(
    proofOfWork.indexOf('export async function runProofAsk'),
    proofOfWork.indexOf('export async function askAboutProofs'),
  );
  assert.match(ask, /office_only:\s*result\.officeOnly === true/);
  assert.match(ask, /excludeOfficeOnlyRows\([\s\S]*askAccess,\s*null/);
  assert.match(ask, /excludeOfficeOnlyRows\([\s\S]*askAccess,\s*threadId/);
  assert.match(ask, /publicPairs/);
  assert.match(ask, /historyWithoutPrivateUploads/);
  assert.match(progressShare, /access:\s*'share'/);
  assert.doesNotMatch(progressShare, /document_ids/);
});

test('a session-only or unrelated upload is private, an attached job document is not', () => {
  const unrelated: AskDocumentView = {
    id: 'note',
    filename: 'The Future.docx',
    attached: false,
    relevance: 'not_related',
    extractedText: 'By Jack Cyganiak\n\nJettx builds long distance wireless power.',
  };
  const sessionOnly: AskDocumentView = {
    ...unrelated,
    relevance: null,
    attached: false,
  };
  const estimate: AskDocumentView = {
    id: 'estimate',
    filename: 'Roof-Estimate.pdf',
    kind: 'estimate',
    attached: true,
    relevance: 'related',
    extractedText: 'Estimate total $4,200 for the roof.',
  };
  assert.equal(sessionAnswerIsPrivate('what is this about', [unrelated]), true);
  assert.equal(sessionAnswerIsPrivate('Who wrote it?', [sessionOnly]), true);
  assert.equal(sessionAnswerIsPrivate("What's the estimate total?", [estimate]), false);
  assert.equal(sessionAnswerIsPrivate("What's the estimate total?", [estimate, unrelated]), false);
  assert.equal(sessionAnswerIsPrivate('what is this about', [estimate, unrelated]), true);
  assert.equal(sessionAnswerIsPrivate("what's the lockbox code?", [unrelated]), false);
});
