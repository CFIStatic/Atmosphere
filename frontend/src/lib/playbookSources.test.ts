import { describe, expect, it } from 'vitest';
import { playbookSourceJobs } from './playbookSources';

const reading = { summary: 'Crew tore off the shingles and dried the deck in.' };

describe('playbookSourceJobs', () => {
  it('offers only jobs with a finished analysis, counting their analysed clips', () => {
    const jobs = playbookSourceJobs([
      {
        jobId: 'j-1',
        jobName: 'Tiffany & Co.',
        jobNumber: 12,
        analysisState: 'done',
        analysis: reading,
      },
      {
        jobId: 'j-1',
        jobName: 'Tiffany & Co.',
        jobNumber: 12,
        analysisState: 'done',
        analysis: reading,
      },
      {
        jobId: 'j-1',
        jobName: 'Tiffany & Co.',
        jobNumber: 12,
        analysisState: 'pending',
        analysis: reading,
      },
      { jobId: 'j-2', jobName: 'Empty job', jobNumber: 13, analysisState: 'pending' },
      { jobId: null, jobName: 'Loose clip', analysisState: 'done', analysis: reading },
    ]);
    expect(jobs).toEqual([{ jobId: 'j-1', label: '#12 Tiffany & Co.', analyzedClips: 2 }]);
  });

  it('skips transcript-only, narration-only, and empty readings the server rejects', () => {
    const jobs = playbookSourceJobs([
      {
        jobId: 'j-transcript',
        jobName: 'Mic only',
        jobNumber: 1,
        analysisState: 'done',
        analysis: { summary: null, changes: [], concerns: [], scope: [] },
      },
      {
        jobId: 'j-narration',
        jobName: 'Narration only',
        jobNumber: 2,
        analysisState: 'done',
        analysis: { summary: '   ', changes: [''], concerns: [], scope: [{ title: ' ' }] },
      },
      {
        jobId: 'j-empty',
        jobName: 'Empty reading',
        jobNumber: 3,
        analysisState: 'done',
      },
      {
        jobId: 'j-work',
        jobName: 'From changes',
        jobNumber: 4,
        analysisState: 'done',
        analysis: { changes: ['Tear-off of existing shingles'] },
      },
      {
        jobId: 'j-scope',
        jobName: 'From scope',
        jobNumber: 5,
        analysisState: 'done',
        analysis: { scope: [{ title: 'Dry-in' }] },
      },
      {
        jobId: 'j-concern',
        jobName: 'From concern',
        jobNumber: 6,
        analysisState: 'done',
        analysis: { concerns: ['Exposed ridge'] },
      },
    ]);
    expect(jobs.map((job) => job.jobId)).toEqual(['j-work', 'j-scope', 'j-concern']);
  });

  it('names a job without a title rather than showing a blank option', () => {
    expect(
      playbookSourceJobs([{ jobId: 'j-3', analysisState: 'done', analysis: reading }])[0]?.label,
    ).toBe('Untitled job');
  });
});
