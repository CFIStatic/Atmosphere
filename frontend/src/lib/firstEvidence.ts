import type { ProofResponse, ProofVideoRecord } from './api';
import { formatClipClock } from './clipDuration';

export interface FirstClipPreview {
  id: string;
  title: string;
  posterUrl: string | null;
  durationSeconds: number | null;
  processing: boolean;
  summary: string | null;
  lines: Array<{ at: string; text: string }>;
}

/** Poster badge length: unknown (empty WebM header) reads as a dash, never 0:00. */
export function posterClock(seconds: number | null | undefined): string {
  return formatClipClock(seconds);
}

export function clock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function busy(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'pending';
}

/**
 * The creator's first filed clip, as the welcome page shows it: title and
 * poster from the evidence library (the Dashboard's names), words and
 * summary from the job proof. Null until a clip has reached the office.
 */
export function firstClipPreview(
  proofs: Pick<ProofResponse, 'videos'> | null | undefined,
  library: Array<{ id: string; title?: string | null; posterUrl?: string | null }> | null | undefined,
): FirstClipPreview | null {
  const videos = [...(proofs?.videos ?? [])].sort((a, b) =>
    String(a.receivedAt ?? a.capturedAt ?? '').localeCompare(String(b.receivedAt ?? b.capturedAt ?? '')),
  );
  const first: ProofVideoRecord | undefined = videos[0];
  if (!first) return null;
  const meta = (library ?? []).find((item) => item.id === first.id);
  const processing =
    busy(first.analysisStatus) || busy(first.transcriptStatus) || busy(first.narrationStatus) || !first.analysisStatus;
  const summary =
    first.conversation?.conversationSummary?.trim() || first.aiSummary?.trim() || null;
  const lines = (first.transcriptSegments ?? [])
    .filter((seg) => seg.text && seg.text.trim())
    .slice(0, 5)
    .map((seg) => ({ at: clock(seg.tSec), text: seg.text.trim() }));
  return {
    id: first.id,
    title: meta?.title?.trim() || 'Your first clip',
    posterUrl: meta?.posterUrl ?? null,
    durationSeconds: first.durationSeconds ?? null,
    processing,
    summary: processing ? null : summary,
    lines,
  };
}

/** Clearly labeled sample for office users with nothing filmed yet. Not customer data. */
export const SAMPLE_EVIDENCE = {
  title: 'Kitchen leak walkthrough',
  /** Synthetic poster of the sample scene. Not a customer clip. */
  posterUrl: '/samples/kitchen-leak-poster.jpg',
  durationSeconds: 38,
  summary:
    'Leak under the kitchen sink; the lower cabinet reads 28% moisture. Plan said on camera: pull the toe kick and set two air movers today; the base cabinet comes out if it is wet behind.',
  lines: [
    { at: '0:04', text: 'This is the kitchen. The leak started under the sink.' },
    { at: '0:11', text: 'Moisture reads twenty-eight percent on the lower cabinet.' },
    { at: '0:19', text: "We'll pull the toe kick and set two air movers today." },
    { at: '0:27', text: 'If the base cabinet is wet behind, it comes out.' },
  ],
  ask: {
    question: 'What was said about the cabinet?',
    answer: '“Moisture reads twenty-eight percent on the lower cabinet.” [0:11] and “If the base cabinet is wet behind, it comes out.” [0:27] Speaker not identified.',
  },
} as const;
