/**
 * Org-wide counts for the office Overview: how much film is on file, and
 * how much of it the assistant has actually read.
 */

export interface ProofPulseClip {
  analysisStatus: string | null;
  transcriptStatus: string | null;
  receivedAt: string | null;
  workDate: string;
}

export interface ProofPulse {
  clips: number;
  read: number;
  analysing: number;
  failed: number;
  unread: number;
  heard: number;
  filmedToday: number;
}

function isSameDay(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

export function summarizeProofPulse(clips: ProofPulseClip[], now = new Date()): ProofPulse {
  let read = 0;
  let analysing = 0;
  let failed = 0;
  let unread = 0;
  let heard = 0;
  let filmedToday = 0;

  for (const clip of clips) {
    const status = clip.analysisStatus;
    if (status === 'queued' || status === 'running') analysing += 1;
    else if (status === 'done') read += 1;
    else if (status === 'failed') failed += 1;
    else unread += 1;

    if (clip.transcriptStatus === 'done') heard += 1;
    if (isSameDay(clip.receivedAt, now) || isSameDay(clip.workDate, now)) filmedToday += 1;
  }

  return {
    clips: clips.length,
    read,
    analysing,
    failed,
    unread,
    heard,
    filmedToday,
  };
}
