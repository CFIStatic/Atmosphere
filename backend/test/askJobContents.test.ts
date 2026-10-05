import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeGroundedAsk,
  composeJobContents,
  isJobContentsQuestion,
} from '../src/shared/askPolish.js';
import {
  planAskLookup,
  type AskLookupCatalog,
  type AskLookupClip,
} from '../src/shared/askLookup.js';
import { routeAskQuestion } from '../src/shared/askRoute.js';

const ORG = 'org-a';
const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';

function clip(partial: Partial<AskLookupClip> & Pick<AskLookupClip, 'proofId' | 'title'>): AskLookupClip {
  return { jobId: JOB, orgId: ORG, ...partial };
}

const tiffany: AskLookupCatalog = {
  orgId: ORG,
  jobId: JOB,
  access: 'org',
  jobTitle: 'Project Tiffany & Co.',
  timeZone: 'America/Chicago',
  clips: [
    clip({
      proofId: '00608802-140e-4897-9f02-1d5d0db88ecf',
      title: 'Clip Opens With Two Nearly Black, Noisy Frames',
      workDate: '2026-09-17',
      durationSeconds: 32.46,
      summary:
        'A single fixed webcam-style take of one seated man speaking to camera from a small office. The first few seconds are black/near-black before the image resolves at about 5 seconds.',
    }),
    clip({
      proofId: 'd088682f-b5c8-400f-ae51-fcbeed97258a',
      title: 'Short Handheld Phone Clip Surveys a Light Whitewashed',
      workDate: '2026-09-21',
      durationSeconds: 33.75,
      summary:
        'Handheld, often blurry phone video shot at a dining/breakfast table inside a home. Most frames are close, out-of-focus views of a pale white-washed wood tabletop.',
    }),
    clip({
      proofId: 'c8d6e77f-6d86-4eee-8312-076038c15bac',
      title: 'Handheld Phone Video Shot Sideways Inside a Home,',
      workDate: '2026-09-21',
      durationSeconds: 44.24,
      summary:
        'A short handheld interior walkthrough of a furnished home, recorded sideways, panning from a ceiling/wall plane with a recessed can light and a chandelier shade, to a shiplap wall holding a large Roman-numeral clock and framed art.',
    }),
  ],
  history: [],
  people: [{ userId: '111832c2-d6f9-4412-86ce-1fccc439eb40', name: 'El Presidente', onThisJob: true, recordedProofIds: [] }],
};

function failedSearchTrace(question: string) {
  return planAskLookup(question, tiffany).map((step) => ({
    tool: step.name,
    input: step.input,
    result:
      step.name === 'search_transcripts'
        ? { ok: true, tool: step.name, summary: 'none', data: { hits: [] } }
        : { ok: true, tool: step.name, summary: 'ok', data: {} },
  }));
}

test('video inventory questions are recognized and routed deep', () => {
  for (const q of [
    'what kind of videos do we have on this job',
    'how many clips are on this file',
    'list the videos on this job',
    'who is on this job',
    'when were the videos filmed',
  ]) {
    assert.equal(isJobContentsQuestion(q), true, q);
    assert.equal(routeAskQuestion({ question: q, catalog: tiffany }).route, 'deep', q);
    assert.equal(routeAskQuestion({ question: q, catalog: tiffany }).reason, 'job_contents', q);
  }
  assert.equal(isJobContentsQuestion('is there a purple dumpster on this job'), false);
});

test('video inventory plan loads clips instead of searching for "kind"', () => {
  const plan = planAskLookup('what kind of videos do we have on this job', tiffany);
  assert.deepEqual(
    plan.map((step) => step.name),
    ['read_job_history', 'get_clip', 'get_clip', 'get_clip'],
  );
  assert.equal(plan.some((step) => step.name === 'search_transcripts'), false);
});

test('Tiffany "what kind of videos" leads with the count and clean bullets', () => {
  const answer = composeGroundedAsk(
    'what kind of videos do we have on this job',
    failedSearchTrace('what kind of videos do we have on this job'),
    tiffany,
  );
  assert.match(answer, /^There are \*\*3 videos\*\* on this job:/);
  assert.doesNotMatch(answer, /Nothing on this file matches|On file:|; /);
  assert.doesNotMatch(answer, /\u2026|sh\.\.\./);
  assert.match(answer, /chandelier shade/);
  assert.match(answer, /- \*\*Sep 17, 32s\.\*\*/);
  assert.match(answer, /- \*\*Sep 21, 34s\.\*\*/);
  assert.match(answer, /- \*\*Sep 21, 44s\.\*\*/);
  assert.match(answer, /dining\/breakfast table/);
  assert.match(answer, /chandelier shade/);
  assert.match(answer, /small office/);
});

test('people and filming-day inventories stay clean', () => {
  assert.match(composeJobContents('who is on this job', tiffany), /There is \*\*1 person\*\* on this job:\n- El Presidente/);
  assert.match(
    composeJobContents('when were the videos filmed', tiffany),
    /Videos on this job were filmed on \*\*Sep 17\*\* and \*\*Sep 21\*\*\./,
  );
});

test('a genuine miss still says nothing matches, with bullet On file context', () => {
  const answer = composeGroundedAsk(
    'is there a purple dumpster on this job',
    failedSearchTrace('is there a purple dumpster on this job'),
    tiffany,
  );
  assert.match(answer, /^Nothing on this file matches that\./);
  assert.match(answer, /On file:\n- Sep /);
  assert.doesNotMatch(answer, /On file: Sep .*Sep /); // no semicolon run-on
});
