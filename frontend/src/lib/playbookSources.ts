/**
 * Which jobs can seed a playbook. The server builds a playbook from a job's
 * analysed clips (POST /api/playbooks/from-job) and refuses a job with none,
 * so the picker only offers jobs that have at least one clip whose analysis
 * finished — anything else would be a button that always errors.
 */

export interface LibraryClipForPlaybook {
  jobId?: string | null;
  jobName?: string | null;
  jobNumber?: number | null;
  analysisState?: string | null;
}

export interface PlaybookSourceJob {
  jobId: string;
  label: string;
  analyzedClips: number;
}

export function playbookSourceJobs(items: readonly LibraryClipForPlaybook[]): PlaybookSourceJob[] {
  const byJob = new Map<string, PlaybookSourceJob>();
  for (const item of items) {
    const jobId = item.jobId?.trim();
    if (!jobId || item.analysisState !== 'done') continue;
    const existing = byJob.get(jobId);
    if (existing) {
      existing.analyzedClips += 1;
      continue;
    }
    const name = item.jobName?.trim() || 'Untitled job';
    const label = item.jobNumber != null ? `#${item.jobNumber} ${name}` : name;
    byJob.set(jobId, { jobId, label, analyzedClips: 1 });
  }
  return [...byJob.values()].sort((a, b) => a.label.localeCompare(b.label));
}
