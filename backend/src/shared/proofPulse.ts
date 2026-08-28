/**
 * Org-wide counts for the office Overview: how much film is on file, how much
 * of it the assistant has actually read, and which jobs that film belongs to.
 *
 * Totals alone are a vanity dashboard. The office needs the job, because
 * "3 unread" is not an action and "Meridian Ave — 2 clips waiting" is.
 */

export interface ProofPulseClip {
  jobId?: string | null;
  analysisStatus: string | null;
  transcriptStatus: string | null;
  receivedAt: string | null;
  workDate: string;
}

export interface ProofPulseJob {
  jobId: string;
  clips: number;
  read: number;
  analysing: number;
  failed: number;
  unread: number;
  heard: number;
  filmedToday: number;
}

export interface ProofPulse {
  clips: number;
  read: number;
  analysing: number;
  failed: number;
  unread: number;
  heard: number;
  filmedToday: number;
  byJob: ProofPulseJob[];
}

function emptyJob(jobId: string): ProofPulseJob {
  return {
    jobId,
    clips: 0,
    read: 0,
    analysing: 0,
    failed: 0,
    unread: 0,
    heard: 0,
    filmedToday: 0,
  };
}

function isSamePulseDay(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

function classifyClip(
  clip: ProofPulseClip,
  now: Date,
  into: {
    clips: number;
    read: number;
    analysing: number;
    failed: number;
    unread: number;
    heard: number;
    filmedToday: number;
  },
): void {
  into.clips += 1;
  const status = clip.analysisStatus;
  if (status === 'queued' || status === 'running') into.analysing += 1;
  else if (status === 'done') into.read += 1;
  else if (status === 'failed') into.failed += 1;
  else into.unread += 1;

  if (clip.transcriptStatus === 'done') into.heard += 1;
  if (isSamePulseDay(clip.receivedAt, now) || isSamePulseDay(clip.workDate, now)) {
    into.filmedToday += 1;
  }
}

export function summarizeProofPulse(clips: ProofPulseClip[], now = new Date()): ProofPulse {
  const totals: Omit<ProofPulse, 'byJob'> = {
    clips: 0,
    read: 0,
    analysing: 0,
    failed: 0,
    unread: 0,
    heard: 0,
    filmedToday: 0,
  };
  const jobs = new Map<string, ProofPulseJob>();

  for (const clip of clips) {
    classifyClip(clip, now, totals);
    const jobId = clip.jobId?.trim();
    if (!jobId) continue;
    const row = jobs.get(jobId) ?? emptyJob(jobId);
    classifyClip(clip, now, row);
    jobs.set(jobId, row);
  }

  return {
    ...totals,
    byJob: [...jobs.values()].sort((a, b) => {
      const urgency = b.failed + b.unread - (a.failed + a.unread);
      if (urgency) return urgency;
      return b.clips - a.clips;
    }),
  };
}
