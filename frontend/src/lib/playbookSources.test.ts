import { describe, expect, it } from 'vitest';
import { playbookSourceJobs } from './playbookSources';

describe('playbookSourceJobs', () => {
  it('offers only jobs with a finished analysis, counting their analysed clips', () => {
    const jobs = playbookSourceJobs([
      { jobId: 'j-1', jobName: 'Tiffany & Co.', jobNumber: 12, analysisState: 'done' },
      { jobId: 'j-1', jobName: 'Tiffany & Co.', jobNumber: 12, analysisState: 'done' },
      { jobId: 'j-1', jobName: 'Tiffany & Co.', jobNumber: 12, analysisState: 'pending' },
      { jobId: 'j-2', jobName: 'Empty job', jobNumber: 13, analysisState: 'pending' },
      { jobId: null, jobName: 'Loose clip', analysisState: 'done' },
    ]);
    expect(jobs).toEqual([{ jobId: 'j-1', label: '#12 Tiffany & Co.', analyzedClips: 2 }]);
  });

  it('names a job without a title rather than showing a blank option', () => {
    expect(playbookSourceJobs([{ jobId: 'j-3', analysisState: 'done' }])[0]?.label).toBe(
      'Untitled job',
    );
  });
});
