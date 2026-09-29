import test from 'node:test';
import assert from 'node:assert/strict';
import { playbookSourceJobs } from '../src/playbooks/generate.js';

const jobs = [
  { id: 'j-tiffany', title: 'Project Tiffany & Co.', job_number: 12 },
  { id: 'j-transcript-only', title: 'Transcript only', job_number: 14 },
  { id: 'j-empty', title: 'Jack Cyganiak', job_number: 13 },
];

test('offers only jobs /from-job would accept, labelled like the Dashboard', () => {
  const out = playbookSourceJobs({
    jobs,
    proofs: [
      {
        id: 'p1',
        job_id: 'j-tiffany',
        phase: 'after',
        analysis_status: 'done',
        ai_summary: 'Handheld walk-through of a whitewashed room.',
        ai_findings: { workPerformed: ['Walk-through'] },
      },
      { id: 'p2', job_id: 'j-tiffany', phase: 'after', analysis_status: 'done', ai_summary: 'Second clip.', ai_findings: null },
      // Library shows this as analysed (transcript done), but /from-job needs a summary or findings.
      { id: 'p3', job_id: 'j-transcript-only', phase: 'after', analysis_status: 'done', ai_summary: null, ai_findings: null },
    ],
  });
  assert.deepEqual(out, [{ jobId: 'j-tiffany', label: '#12 Project Tiffany & Co.', analyzedClips: 2 }]);
});

test('a job whose findings carry nothing usable is not offered', () => {
  const out = playbookSourceJobs({
    jobs,
    proofs: [{ id: 'p4', job_id: 'j-empty', phase: 'after', analysis_status: 'done', ai_summary: '  ', ai_findings: { unrelated: true } }],
  });
  assert.deepEqual(out, []);
});
