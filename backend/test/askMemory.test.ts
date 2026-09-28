/**
 * Long-horizon Ask memory: a bounded summary, durable notes, and recall
 * after the verbatim window has moved on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planAskLookup, scrubStoredAskText, type AskLookupCatalog, type AskLookupClip } from '../src/shared/askLookup.js';
import {
  foldThreadMemory,
  isLongMemoryQuestion,
  mergeDurableNotes,
  recallLongMemory,
  scrubLongMemory,
  type StoredAskPair,
} from '../src/shared/askMemory.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function pairId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function longThread(): StoredAskPair[] {
  const start = Date.parse('2026-09-21T15:00:00.000Z');
  const pairs: StoredAskPair[] = [
    {
      id: pairId(1),
      question: 'Please keep the homeowner summaries brief. We decided to redo the tabletop in walnut.',
      answer: 'Noted. Homeowner summaries stay brief, and the tabletop will be redone in walnut.',
      createdAt: new Date(start).toISOString(),
    },
  ];
  for (let i = 1; i <= 52; i += 1) {
    pairs.push({
      id: pairId(i + 1),
      question: `What is on the clip from visit ${i}?`,
      answer: `Visit ${i} is on the file. Nothing new was decided.`,
      createdAt: new Date(start + i * 3 * 60 * 60 * 1000).toISOString(),
    });
  }
  return pairs;
}

test('a memory question is not a clip search', () => {
  assert.equal(isLongMemoryQuestion('Last week you said something about the tabletop. What did we decide?'), true);
  assert.equal(isLongMemoryQuestion('what did we decide about the tabletop'), true);
  assert.equal(isLongMemoryQuestion('what did El Presidente say about the tarp'), false);
  assert.equal(isLongMemoryQuestion('What did he say?'), false);
  assert.equal(isLongMemoryQuestion('what was this job about'), false);
});

test('older turns fold into a bounded summary and the early decision stays a note', () => {
  const pairs = longThread();
  assert.ok(pairs.length >= 51);
  const now = '2026-09-28T16:00:00.000Z';
  const folded = foldThreadMemory({ pairs, timeZone: 'America/Chicago' });
  assert.ok(folded.recent.length <= 8);
  assert.ok(folded.recent.length >= 2);
  assert.doesNotMatch(folded.recent.map((turn) => turn.text).join('\n'), /walnut/i);
  assert.match(folded.summary, /walnut/i);
  assert.match(folded.summary, /homeowner summaries brief/i);
  assert.ok(folded.summary.length < 2200);
  assert.equal(folded.regenerate, true);
  assert.equal(folded.summaryThroughId, pairs[pairs.length - 5]?.id);

  const table = folded.notes.find((note) => /tabletop/i.test(note.note));
  const brief = folded.notes.find((note) => /homeowner summaries brief/i.test(note.note));
  assert.ok(table);
  assert.match(table!.note, /decided to redo the tabletop in walnut/i);
  assert.equal(table!.sourceQuestionId, pairs[0]!.id);
  assert.equal(brief?.note, 'user wants homeowner summaries brief');
  assert.equal(brief?.sourceQuestionId, pairs[0]!.id);

  const kept = foldThreadMemory({
    pairs,
    previousSummary: folded.summary,
    summarizedThroughId: folded.summaryThroughId,
    timeZone: 'America/Chicago',
  });
  assert.equal(kept.regenerate, false);
  assert.equal(kept.summary, folded.summary);

  const grown = pairs.concat({
    id: pairId(900),
    question: 'What is on the clip from the latest visit?',
    answer: 'The latest visit is on the file.',
    createdAt: '2026-09-28T18:00:00.000Z',
  });
  const again = foldThreadMemory({
    pairs: grown,
    previousSummary: folded.summary,
    summarizedThroughId: folded.summaryThroughId,
    timeZone: 'America/Chicago',
  });
  assert.equal(again.regenerate, true);
  assert.match(again.summary, /walnut/i);

  const recalled = recallLongMemory(
    'Last week you said something about the tabletop. What did we decide?',
    { summary: folded.summary, notes: folded.notes, now },
    { timeZone: 'America/Chicago' },
  );
  assert.match(recalled, /Last week you decided to redo the tabletop in walnut/);
  assert.match(recalled, /Sep 21/);
  assert.match(recalled, /from the turn on Sep 21/);
  assert.doesNotMatch(recalled, /This file does not have that/i);

  const tail = pairs.slice(-20);
  const gapped = foldThreadMemory({
    pairs: tail,
    previousSummary: folded.summary,
    summarizedThroughId: pairs[0]!.id,
    incomplete: true,
    timeZone: 'America/Chicago',
  });
  assert.match(gapped.summary, /walnut/i);
  assert.equal(gapped.regenerate, false);

  const fresh = foldThreadMemory({ pairs: [] });
  assert.equal(fresh.summary, '');
  assert.equal(fresh.recent.length, 0);
  const carried = mergeDurableNotes(folded.notes, fresh.notes);
  assert.ok(carried.some((note) => /walnut/i.test(note.note)));
});

test('a stored summary and note do not keep a redacted secret', () => {
  const secret = 'The lockbox code is 4412.';
  const clip = {
    proofId: '00608802-140e-4897-9f02-1d5d0db88ecf',
    jobId: 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df',
    orgId: '8b2cc105-1eec-4123-90db-fdcbc5565252',
    title: 'Office',
    segments: [{ start: 12, end: 14, text: secret }],
    privacyRedactions: { ranges: [{ startSec: 11, endSec: 15, reason: 'private', confidence: 0.9, source: 'vision' }] },
  } as AskLookupClip;
  const pairs: StoredAskPair[] = [];
  for (let i = 0; i < 6; i += 1) {
    pairs.push({
      id: pairId(i + 1),
      question: i === 0 ? `We decided to redo the tabletop. ${secret}` : `Visit note ${i}`,
      answer: i === 0 ? `Noted. ${secret}` : `Visit ${i} is filed.`,
      createdAt: new Date(Date.parse('2026-09-01T15:00:00.000Z') + i * 86_400_000).toISOString(),
    });
  }
  const folded = foldThreadMemory({ pairs, timeZone: 'America/Chicago' });
  const scrubbed = scrubLongMemory(folded, (text) => scrubStoredAskText(text, [clip]));
  assert.match(folded.summary, /4412/);
  assert.doesNotMatch(scrubbed.summary, /4412/);
  assert.match(scrubbed.summary, /\[privacy redacted\]/);
  assert.ok(scrubbed.notes.every((note) => !/4412/.test(note.note)));
  assert.ok(scrubbed.notes.some((note) => /tabletop/i.test(note.note)));
});

test('ask_job_notes inserts require org membership and a job in that org', () => {
  const name = '20260928143000_ask_job_notes_insert_scope.sql';
  const backendSql = fs.readFileSync(path.join(here, '../supabase/migrations', name), 'utf8');
  const rootSql = fs.readFileSync(path.join(here, '../../supabase/migrations', name), 'utf8');
  assert.equal(backendSql, rootSql);
  assert.match(backendSql, /drop policy if exists ask_job_notes_insert on public\.ask_job_notes/);
  assert.match(backendSql, /create policy ask_job_notes_insert_member_job on public\.ask_job_notes/);
  assert.match(backendSql, /private\.is_org_member\(org_id\)/);
  assert.match(backendSql, /owner_user_id = auth\.uid\(\)/);
  assert.match(backendSql, /crm_jobs\.id = job_id/);
  assert.match(backendSql, /crm_jobs\.org_id = ask_job_notes\.org_id/);
  assert.doesNotMatch(backendSql, /or owner_user_id = auth\.uid\(\)/);
  assert.doesNotMatch(backendSql, /alter table public\.job_proof_questions/i);
  assert.doesNotMatch(backendSql, /update public\.job_proof_questions/i);
  assert.doesNotMatch(backendSql, /job_evidence_access/i);
  assert.doesNotMatch(backendSql, /grant update|grant delete/i);
});

test('the memory migration does not rewrite custody answers', () => {
  const backendSql = fs.readFileSync(
    path.join(here, '../supabase/migrations/20260928120000_ask_thread_memory.sql'),
    'utf8',
  );
  const rootSql = fs.readFileSync(
    path.join(here, '../../supabase/migrations/20260928120000_ask_thread_memory.sql'),
    'utf8',
  );
  assert.equal(backendSql, rootSql);
  assert.match(backendSql, /rolling_summary/);
  assert.match(backendSql, /ask_job_notes/);
  assert.match(backendSql, /owner_user_id = auth\.uid\(\)/);
  assert.match(backendSql, /private\.is_org_member\(org_id\)/);
  assert.doesNotMatch(backendSql, /alter table public\.job_proof_questions/i);
  assert.doesNotMatch(backendSql, /update public\.job_proof_questions/i);
  assert.doesNotMatch(backendSql, /job_proof_questions_append_only/i);
  assert.match(backendSql, /grant select, insert on public\.ask_job_notes to authenticated/);
  assert.doesNotMatch(backendSql, /grant update|grant delete/i);
});

test('recall does not plan a transcript search', () => {
  const catalog = {
    orgId: '8b2cc105-1eec-4123-90db-fdcbc5565252',
    jobId: 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df',
    access: 'org',
    timeZone: 'America/Chicago',
    clips: [],
    people: [],
  } satisfies AskLookupCatalog;
  assert.deepEqual(
    planAskLookup('Last week you said something about the tabletop. What did we decide?', catalog),
    [],
  );
  const speech = planAskLookup('what did El Presidente say about the tarp', {
    ...catalog,
    people: [
      {
        userId: '111832c2-d6f9-4412-86ce-1fccc439eb40',
        name: 'El Presidente',
        onThisJob: true,
        recordedProofIds: [],
        taggedProofIds: [],
      },
    ],
  });
  assert.ok(speech.some((step) => step.name === 'list_person_activity' || step.name === 'search_transcripts'));
});
