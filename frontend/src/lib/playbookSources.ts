/**
 * Which jobs can seed a playbook. POST /api/playbooks/from-job keeps a clip
 * only when its vision analysis finished (`analysis_status === 'done'`) and
 * that reading has a summary, work performed, a scope verdict, or a concern.
 * The library flag `analysisState` is also "done" for transcript-only and
 * narration-only clips, which the server refuses with playbook_no_analysis.
 */

export interface LibraryClipForPlaybook {
  jobId?: string | null;
  jobName?: string | null;
  jobNumber?: number | null;
  analysisState?: string | null;
  /** Same reading the playbook generator turns into steps. */
  analysis?: {
    summary?: string | null;
    changes?: unknown;
    concerns?: unknown;
    /** Present when a payload includes work performed separately from changes. */
    workPerformed?: unknown;
    scope?: Array<{ title?: string | null } | null> | null;
  } | null;
}

export interface PlaybookSourceJob {
  jobId: string;
  label: string;
  analyzedClips: number;
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasTextList(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => hasText(item));
}

/** A clip the from-job endpoint can turn into a step, not merely a finished transcript. */
function clipCanSeedPlaybook(item: LibraryClipForPlaybook): boolean {
  if (item.analysisState !== 'done') return false;
  const analysis = item.analysis;
  if (!analysis) return false;
  if (hasText(analysis.summary)) return true;
  if (hasTextList(analysis.changes) || hasTextList(analysis.workPerformed)) return true;
  if (hasTextList(analysis.concerns)) return true;
  return Array.isArray(analysis.scope) && analysis.scope.some((line) => hasText(line?.title));
}

export function playbookSourceJobs(items: readonly LibraryClipForPlaybook[]): PlaybookSourceJob[] {
  const byJob = new Map<string, PlaybookSourceJob>();
  for (const item of items) {
    const jobId = item.jobId?.trim();
    if (!jobId || !clipCanSeedPlaybook(item)) continue;
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
